import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

vm.runInThisContext(fs.readFileSync(new URL("./rules.js", import.meta.url), "utf8"), { filename: "rules.js" });
const { MAX_STAGE, HERO_DEFS, BONFIRE_NODE_TYPES, enemyStats, xpNeeded, skillEvolutionTier } = globalThis.AbyssRules;
const TARGET_HOURS = Number(process.argv.find(arg => arg.startsWith("--hours="))?.split("=")[1] || 80);
const RUNS = Math.max(1, Number(process.argv.find(arg => arg.startsWith("--runs="))?.split("=")[1] || 8));

function simulate(seed) {
  let randomState = seed >>> 0;
  const random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 4294967296; };
  const state = {
    stage: 1, bestStage: 1, gold: 40, dust: 0, embers: 0, elapsed: 0,
    level: [1, 1, 1], xp: [0, 0, 0], training: [0, 0, 0],
    skills: Array.from({ length: 3 }, () => [1, 0, 0, 0]),
    gear: Array(9).fill(0), dropMeter: 0,
    bonfire: 0, rebirths: 0, bossFailures: 0, kills: 0, completed: false,
    reached100: false, reached200: false
  };

  const speed = () => state.bestStage >= 1000 ? 4 : state.bestStage >= 100 ? 2 : 1;
  const countNode = type => {
    const index = BONFIRE_NODE_TYPES.indexOf(type);
    return index < 0 || state.bonfire <= index ? 0 : Math.floor((state.bonfire - 1 - index) / BONFIRE_NODE_TYPES.length) + 1;
  };
  const bonus = (type, per) => 1 + countNode(type) * per;
  const trainCost = i => Math.floor(25 * Math.pow(1.18, state.training[i]) * (1 + i * .04));
  const skillCost = (i, skill) => Math.floor(70 * Math.pow(1.42, state.skills[i][skill]) * (1 + skill * .7));
  const unlockSkills = i => {
    if (state.level[i] >= 10 && state.skills[i][1] === 0) state.skills[i][1] = 1;
    if (state.level[i] >= 25 && state.skills[i][2] === 0) state.skills[i][2] = 1;
    if (state.level[i] >= 50 && state.skills[i][3] === 0) state.skills[i][3] = 1;
  };
  const addXp = amount => state.level.forEach((_, i) => {
    state.xp[i] += amount * bonus("xp", .04);
    while (state.xp[i] >= xpNeeded(state.level[i])) {
      state.xp[i] -= xpNeeded(state.level[i]); state.level[i]++; unlockSkills(i);
      if (state.level[i] >= 100) state.reached100 = true;
      if (state.level[i] >= 200) state.reached200 = true;
    }
  });

  function heroStats(i) {
    const def = HERO_DEFS[i], effectiveLevel = Math.min(state.level[i], 100), levelMult = 1 + (effectiveLevel - 1) * .075, trainMult = 1 + state.training[i] * .09;
    const weapon = state.gear[i * 3], armor = state.gear[i * 3 + 1], relic = state.gear[i * 3 + 2];
    const all = bonus("all", .015), evolution = skillEvolutionTier(state.level[i]);
    let atk = def.baseAtk * levelMult * trainMult + weapon;
    let hp = def.baseHp * levelMult * trainMult + armor * 8;
    let defense = def.baseDef * (1 + (effectiveLevel - 1) * .055) * (1 + state.training[i] * .065) + armor * .45;
    let crit = (i === 1 ? .14 : .05) + relic * .00065;
    if (i === 0) { hp *= 1 + evolution * .14; defense *= 1 + evolution * .12; }
    if (i === 1) { atk *= 1 + evolution * .13; crit += evolution * .035; }
    return {
      atk: atk * bonus("attack", .035) * all,
      hp: hp * bonus("vitality", .035) * all,
      def: defense * bonus("vitality", .035) * all,
      crit: Math.min(.65, crit), heal: (i === 2 ? atk * 2.3 * (1 + evolution * .16) : atk) * bonus("vitality", .035) * all
    };
  }

  function teamDps(boss) {
    const skillBoost = 1 + state.skills.flat().reduce((sum, level) => sum + Math.max(0, level - 1), 0) * .0025;
    return HERO_DEFS.reduce((sum, def, i) => {
      const stats = heroStats(i), critDmg = i === 1 ? 1.85 : 1.55;
      return sum + stats.atk / def.interval * (1 + stats.crit * (critDmg - 1)) * (i === 1 ? 1.28 : 1.12);
    }, 0) * skillBoost * (boss ? bonus("attack", .035) : 1);
  }

  function autoSpend() {
    let guard = 0;
    while (guard++ < 10000) {
      const choices = [];
      state.training.forEach((_, i) => choices.push({ type: "train", i, cost: trainCost(i), gain: [1, 1.12, 1.02][i] * .08 }));
      state.skills.forEach((skills, i) => skills.forEach((level, skill) => {
        if (skill && level > 0) choices.push({ type: "skill", i, skill, cost: skillCost(i, skill), gain: (i === 1 ? 1.35 : 1) * .06 });
      }));
      const choice = choices.filter(item => item.cost <= state.gold).sort((a, b) => b.gain / b.cost - a.gain / a.cost)[0];
      if (!choice) break;
      state.gold -= choice.cost;
      if (choice.type === "train") state.training[choice.i]++; else state.skills[choice.i][choice.skill]++;
    }
  }

  function reward(stage, foe, spend = true) {
    state.gold += (12 + stage * .85) * (foe.boss ? 12 : foe.elite ? 3 : 1) * bonus("gold", .04);
    addXp((8 + stage * .48) * (foe.boss ? 8 : foe.elite ? 2 : 1));
    state.dropMeter += (foe.boss ? .08 : .075) * bonus("gear", .025);
    if (foe.boss) state.embers += 2 + Math.floor(stage / 500);
    if (foe.boss) {
      const rarity = [1, 1.8, 3.2, 5.7, 10][Math.min(4, Math.floor((stage - 1) / 2000))];
      const weakest = state.gear.reduce((best, value, index, values) => value < values[best] ? index : best, 0);
      state.gear[weakest] = Math.max(state.gear[weakest], Math.round((5 + stage * .18) * rarity * (.86 + random() * .28)));
    }
    while (state.dropMeter >= 1) {
      state.dropMeter--;
      const slot = Math.floor(random() * 9), rarity = random() < .007 ? 10 : random() < .04 ? 5.7 : random() < .14 ? 3.2 : random() < .4 ? 1.8 : 1;
      const candidate = Math.round((5 + stage * .18) * rarity * (.86 + random() * .28));
      if (candidate > state.gear[slot]) state.gear[slot] = candidate;
    }
    state.kills++; if (spend) autoSpend();
  }

  function farmRewards(stage, foe, runs) {
    state.gold += (12 + stage * .85) * (foe.elite ? 3 : 1) * bonus("gold", .04) * runs;
    addXp((8 + stage * .48) * (foe.elite ? 2 : 1) * runs);
    state.dropMeter += .075 * bonus("gear", .025) * runs;
    while (state.dropMeter >= 1) {
      state.dropMeter--;
      const slot = Math.floor(random() * 9), rarity = random() < .007 ? 10 : random() < .04 ? 5.7 : random() < .14 ? 3.2 : random() < .4 ? 1.8 : 1;
      const candidate = Math.round((5 + stage * .18) * rarity * (.86 + random() * .28));
      if (candidate > state.gear[slot]) state.gear[slot] = candidate;
    }
    state.kills += runs; autoSpend();
  }

  const rebirthReward = () => Math.max(1, Math.floor(Math.pow(state.bestStage / 100, .72) * 5));
  const lightBonfire = () => { while (state.embers >= 1 + Math.floor(state.bonfire / 6)) { state.embers -= 1 + Math.floor(state.bonfire / 6); state.bonfire++; } };
  const projectedNodes = rewardValue => {
    let embers = state.embers + rewardValue, level = state.bonfire, nodes = 0;
    while (nodes < 1000 && embers >= 1 + Math.floor(level / 6)) { embers -= 1 + Math.floor(level / 6); level++; nodes++; }
    return nodes;
  };
  const rebirth = () => {
    state.embers += rebirthReward(); state.rebirths++; state.stage = 1; state.gold = 40;
    state.level.fill(1); state.xp.fill(0); state.training.fill(0); state.skills.forEach(row => row.splice(0, 4, 1, 0, 0, 0));
    state.bossFailures = 0; lightBonfire(); autoSpend();
  };

  while (state.elapsed < TARGET_HOURS * 3600 && !state.completed) {
    const foe = enemyStats(state.stage), family = foe.boss ? foe.zoneIndex : -1;
    let dps = teamDps(foe.boss) * (.94 + random() * .12);
    if (family === 1) dps *= .88;
    if (family === 2) dps = Math.max(1, dps - foe.hp * (.007 + foe.evo * .0007) / 4.2);
    const effectiveHp = foe.hp * (family === 9 ? 1.04 + foe.evo * .004 : 1);
    const killTime = effectiveHp / Math.max(1, dps);
    const tank = heroStats(0), priest = heroStats(2);
    let danger = foe.boss ? .94 : .72;
    if (family === 0) danger *= 1.18; if (family === 3) danger *= 1.28; if (family === 4) danger *= 1.16;
    if (family === 5) danger *= 1.2; if (family === 8) danger *= 1.12; if (family === 9) danger *= 1.28;
    const incoming = Math.max(1, foe.atk / (foe.boss ? 1.05 : 1.35) * danger - priest.heal * .32) * killTime;
    const survives = incoming < tank.hp * 1.8 + priest.hp;
    if (killTime <= foe.limit && survives) {
      state.elapsed += (killTime + .48) / speed(); reward(state.stage, foe);
      state.bestStage = Math.max(state.bestStage, state.stage);
      if (state.stage === MAX_STAGE) state.completed = true; else state.stage++;
      state.bossFailures = 0;
    } else if (foe.boss) {
      state.elapsed += foe.limit / speed(); state.bossFailures++;
      const farm = enemyStats(state.stage - 1), farmTime = Math.max(.2, farm.hp / Math.max(1, teamDps(false)) + .48);
      const runs = Math.max(1, Math.floor(30 * speed() / farmTime));
      farmRewards(state.stage - 1, farm, runs);
      state.elapsed += 30;
      if (state.bossFailures >= 5) {
        const nodes = projectedNodes(rebirthReward());
        if (state.bestStage >= 100 && nodes >= 3 && nodes * .035 >= .1) rebirth();
      }
    } else {
      const progress = Math.max(.05, Math.min(.9, dps * foe.limit / foe.hp));
      state.gold += (12 + state.stage * .85) * .18 * progress * bonus("gold", .04);
      addXp((8 + state.stage * .48) * .14 * progress);
      state.elapsed += foe.limit / speed(); state.bossFailures++; autoSpend();
      if (state.bossFailures >= 5) {
        const nodes = projectedNodes(rebirthReward());
        if (state.bestStage >= 100 && nodes >= 3 && nodes * .035 >= .1) rebirth();
      }
    }
  }
  return { hours: state.elapsed / 3600, completed: state.completed, stage: state.stage, bestStage: state.bestStage, rebirths: state.rebirths, bonfire: state.bonfire, maxLevel: Math.max(...state.level), reached100: state.reached100, reached200: state.reached200 };
}

const results = Array.from({ length: RUNS }, (_, index) => simulate(20260805 + index * 7919));
const completedHours = results.filter(result => result.completed).map(result => result.hours).sort((a, b) => a - b);
const percentile = value => completedHours.length ? completedHours[Math.min(completedHours.length - 1, Math.max(0, Math.floor((completedHours.length - 1) * value)))] : null;
const roundedPercentile = value => { const result = percentile(value); return result === null ? null : +result.toFixed(2); };
const summary = {
  runs: RUNS, completed: completedHours.length,
  completionHours: { p10: roundedPercentile(.1), p50: roundedPercentile(.5), p90: roundedPercentile(.9) },
  levelMilestones: { reached100: results.filter(result => result.reached100).length, reached200: results.filter(result => result.reached200).length },
  sample: results[0]
};

assert.ok(results.every(result => result.bestStage > 100), "模拟未能稳定越过首个Boss");
if (TARGET_HOURS === 80) {
  assert.equal(completedHours.length, RUNS, "所有随机样本都必须在80小时目标内完成第10000关");
  assert.ok(summary.completionHours.p10 >= 50 && summary.completionHours.p90 <= 80, "通关时间分布必须保持在50至80小时窗口");
  assert.ok(summary.levelMilestones.reached100 === RUNS && summary.levelMilestones.reached200 === RUNS, "100/200级技能进化必须在完整远征中可达");
}
console.log(JSON.stringify(summary, null, 2));
