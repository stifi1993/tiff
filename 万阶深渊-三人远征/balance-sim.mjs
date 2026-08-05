import assert from "node:assert/strict";

const MAX_STAGE = 10000;
const TARGET_HOURS = Number(process.argv.find(arg => arg.startsWith("--hours="))?.split("=")[1] || 80);
const BASE = [
  { hp: 280, atk: 11, def: 15, interval: 1.25 },
  { hp: 135, atk: 25, def: 6, interval: .78 },
  { hp: 170, atk: 10, def: 8, interval: 1.4 }
];

const state = {
  stage: 1, bestStage: 1, gold: 40, dust: 0, embers: 0, elapsed: 0,
  level: [1, 1, 1], xp: [0, 0, 0], training: [0, 0, 0],
  skills: Array.from({ length: 3 }, () => [1, 0, 0, 0]),
  gear: Array(9).fill(0), gearEnhance: Array(9).fill(0), dropMeter: 0,
  bonfire: 0, rebirths: 0, bossFailures: 0, kills: 0, completed: false
};

const zoneOf = stage => Math.min(9, Math.floor((stage - 1) / 1000));
const speed = () => state.bestStage >= 1000 ? 4 : state.bestStage >= 100 ? 2 : 1;
const countNode = type => {
  const types = ["attack", "vitality", "gold", "xp", "gear", "all"];
  let count = 0;
  for (let i = 0; i < state.bonfire; i++) if (types[i % 6] === type) count++;
  return count;
};
const bonus = (type, per) => 1 + countNode(type) * per;
const xpNeed = level => 55 * Math.pow(1.145, level - 1);
const trainCost = i => Math.floor(25 * Math.pow(1.18, state.training[i]) * (1 + i * .04));
const skillCost = (i, skill) => Math.floor(70 * Math.pow(1.42, state.skills[i][skill]) * (1 + skill * .7));
const unlockSkills = i => {
  if (state.level[i] >= 10 && state.skills[i][1] === 0) state.skills[i][1] = 1;
  if (state.level[i] >= 25 && state.skills[i][2] === 0) state.skills[i][2] = 1;
  if (state.level[i] >= 50 && state.skills[i][3] === 0) state.skills[i][3] = 1;
};
const addXp = amount => state.level.forEach((_, i) => {
  state.xp[i] += amount * bonus("xp", .04);
  while (state.xp[i] >= xpNeed(state.level[i])) {
    state.xp[i] -= xpNeed(state.level[i]); state.level[i]++; unlockSkills(i);
  }
});

function heroStats(i) {
  const levelMult = 1 + (state.level[i] - 1) * .075;
  const trainMult = 1 + state.training[i] * .09;
  const weapon = state.gear[i * 3], armor = state.gear[i * 3 + 1], relic = state.gear[i * 3 + 2];
  const all = bonus("all", .015);
  return {
    atk: (BASE[i].atk * levelMult * trainMult + weapon) * bonus("attack", .035) * all,
    hp: (BASE[i].hp * levelMult * trainMult + armor * 8) * bonus("vitality", .035) * all,
    def: (BASE[i].def * (1 + (state.level[i] - 1) * .055) * (1 + state.training[i] * .065) + armor * .45) * bonus("vitality", .035) * all,
    crit: Math.min(.65, (i === 1 ? .14 : .05) + relic * .00065)
  };
}

function teamDps(boss) {
  const skillBoost = 1 + state.skills.flat().reduce((sum, level) => sum + Math.max(0, level - 1), 0) * .0025;
  return BASE.reduce((sum, def, i) => {
    const s = heroStats(i), critDmg = i === 1 ? 1.85 : 1.55;
    return sum + s.atk / def.interval * (1 + s.crit * (critDmg - 1)) * (i === 1 ? 1.28 : 1.12);
  }, 0) * skillBoost * (boss ? bonus("attack", .035) : 1);
}

function enemy(stage) {
  const boss = stage % 100 === 0, elite = !boss && stage % 10 === 0, zone = zoneOf(stage);
  const power = Math.pow(1.0006725, stage - 1) * (1 + zone * .42);
  return {
    boss, elite,
    hp: 115 * power * (boss ? 17 : elite ? 3.1 : 1),
    atk: 10 * Math.pow(1.0006, stage - 1) * (boss ? 2.8 : elite ? 1.5 : 1),
    limit: boss ? 30 : 12
  };
}

function autoSpend() {
  let guard = 0;
  while (guard++ < 10000) {
    const choices = [];
    state.training.forEach((_, i) => choices.push({ type: "train", i, cost: trainCost(i), gain: [1, 1.12, 1.02][i] * .08 }));
    state.skills.forEach((skills, i) => skills.forEach((level, skill) => {
      if (skill && level > 0) choices.push({ type: "skill", i, skill, cost: skillCost(i, skill), gain: (i === 1 ? 1.35 : 1) * .06 });
    }));
    const choice = choices.filter(x => x.cost <= state.gold).sort((a, b) => b.gain / b.cost - a.gain / a.cost)[0];
    if (!choice) break;
    state.gold -= choice.cost;
    if (choice.type === "train") state.training[choice.i]++;
    else state.skills[choice.i][choice.skill]++;
  }
}

function reward(stage, foe) {
  const mult = bonus("gold", .04);
  state.gold += (12 + stage * .85) * (foe.boss ? 12 : foe.elite ? 3 : 1) * mult;
  addXp((8 + stage * .48) * (foe.boss ? 8 : foe.elite ? 2 : 1));
  state.dropMeter += (foe.boss ? .08 : .075) * bonus("gear", .025);
  if (foe.boss) { state.embers += 2 + Math.floor(stage / 500); state.dropMeter += 1; }
  while (state.dropMeter >= 1) {
    state.dropMeter--;
    const slot = state.kills % 9;
    const candidate = Math.round((5 + stage * .18) * 1.65);
    if (candidate > state.gear[slot]) state.gear[slot] = candidate;
  }
  state.kills++;
  autoSpend();
}

function rebirthReward() { return Math.max(1, Math.floor(Math.pow(state.bestStage / 100, .72) * 5)); }
function lightBonfire() {
  while (state.embers >= 1 + Math.floor(state.bonfire / 6)) {
    state.embers -= 1 + Math.floor(state.bonfire / 6); state.bonfire++;
  }
}
function projectedNodes(reward) {
  let embers = state.embers + reward, level = state.bonfire, nodes = 0;
  while (nodes < 1000 && embers >= 1 + Math.floor(level / 6)) { embers -= 1 + Math.floor(level / 6); level++; nodes++; }
  return nodes;
}
function rebirth() {
  state.embers += rebirthReward(); state.rebirths++; state.stage = 1; state.gold = 40;
  state.level.fill(1); state.xp.fill(0); state.training.fill(0); state.skills.forEach(x => x.splice(0, 4, 1, 0, 0, 0));
  state.bossFailures = 0; lightBonfire(); autoSpend();
}

while (state.elapsed < TARGET_HOURS * 3600 && !state.completed) {
  const foe = enemy(state.stage), dps = teamDps(foe.boss), killTime = foe.hp / Math.max(1, dps);
  const tank = heroStats(0), priest = heroStats(2);
  const incoming = Math.max(1, foe.atk - tank.def * .65) * killTime / (foe.boss ? 1.05 : 1.35);
  const survives = incoming < tank.hp * 1.8 + priest.hp;
  if (killTime <= foe.limit && survives) {
    state.elapsed += (killTime + .48) / speed();
    reward(state.stage, foe);
    state.bestStage = Math.max(state.bestStage, state.stage);
    if (state.stage === MAX_STAGE) state.completed = true;
    else state.stage++;
    state.bossFailures = 0;
  } else if (foe.boss) {
    state.elapsed += foe.limit / speed(); state.bossFailures++;
    const farm = enemy(state.stage - 1), farmTime = Math.max(.2, farm.hp / Math.max(1, teamDps(false)) + .48);
    const runs = Math.max(1, Math.floor(30 * speed() / farmTime));
    for (let i = 0; i < runs; i++) reward(state.stage - 1, farm);
    state.elapsed += 30;
    if (state.bossFailures >= 5) {
      const nodes = projectedNodes(rebirthReward());
      if (state.bestStage >= 100 && nodes >= 3 && nodes * .035 >= .1) rebirth();
    }
  } else {
    const progress = Math.max(.05, Math.min(.9, dps * foe.limit / foe.hp));
    state.gold += (12 + state.stage * .85) * .18 * progress * bonus("gold", .04);
    addXp((8 + state.stage * .48) * .14 * progress);
    state.elapsed += foe.limit / speed(); autoSpend();
  }
}

const result = {
  targetHours: TARGET_HOURS,
  elapsedHours: +(state.elapsed / 3600).toFixed(2),
  stage: state.stage,
  bestStage: state.bestStage,
  completed: state.completed,
  rebirths: state.rebirths,
  bonfireLevel: state.bonfire,
  teamLevel: state.level,
  training: state.training
};

assert.ok(result.bestStage > 100, "80小时模型未能越过首个Boss，基础曲线无效");
if (TARGET_HOURS === 80) {
  assert.equal(result.completed, true, "80小时目标内必须完成第10000关");
  assert.ok(result.elapsedHours >= 60 && result.elapsedHours <= 90, "预计通关时间必须保持在60至90小时区间");
}
console.log(JSON.stringify(result, null, 2));
