(() => {
  "use strict";

  const SAVE_KEY = "abyss-expedition-v1";
  const BACKUP_KEY = "abyss-expedition-backup-v1";
  const SAVE_VERSION = 2;
  const MAX_STAGE = 10000;
  const OFFLINE_CAP = 12 * 60 * 60;
  const ACTION_ROWS = { idle: 0, move: 1, attack: 2, skill: 3, ultimate: 4, hit: 5, down: 6 };

  const ZONES = [
    { name: "苔痕地窟", boss: "苔岩巨魔", desc: "盘踞在潮湿石窟中的远古巨兽。", enemies: ["洞穴黏怪", "苔甲鼠", "石牙蝠"], hue: "#59774b" },
    { name: "废弃矿井", boss: "钢甲虫王", desc: "吞噬矿脉、披覆钢甲的虫群主宰。", enemies: ["矿镐傀儡", "铁壳甲虫", "幽灯矿工"], hue: "#b17a3d" },
    { name: "亡魂墓穴", boss: "亡灵巫妖", desc: "以千年亡魂维系不朽王冠。", enemies: ["墓穴骷髅", "缚魂幽灵", "腐朽守卫"], hue: "#7b63a6" },
    { name: "熔火锻炉", boss: "熔炉魔像", desc: "远古锻炉中永不停息的熔火核心。", enemies: ["熔岩幼体", "锻炉恶犬", "火炭傀儡"], hue: "#d75c36" },
    { name: "水晶深渊", boss: "水晶九头蛇", desc: "每颗头颅都折射着致命晶光。", enemies: ["晶簇爬虫", "辉光水母", "镜甲蜥蜴"], hue: "#48a9b5" },
    { name: "腐毒下水道", boss: "腐毒憎恶", desc: "由炼金废液与遗骸缝合而成。", enemies: ["毒囊蛙", "疫病鼠王", "污泥行者"], hue: "#7d9b43" },
    { name: "永冻王陵", boss: "冰冠亡王", desc: "冻土王座上的最后一位守墓人。", enemies: ["霜骨兵", "冰晶女妖", "雪墓骑士"], hue: "#72a9d6" },
    { name: "虚空监牢", boss: "虚空狱卒", desc: "看守现实裂隙的无面执刑者。", enemies: ["裂隙之眼", "锁链幽影", "虚空囚徒"], hue: "#855fc6" },
    { name: "龙骨禁区", boss: "龙骨君主", desc: "披挂万龙遗骨的深渊领主。", enemies: ["骨翼幼龙", "龙墓祭司", "骸骨巨蜥"], hue: "#c9a567" },
    { name: "魔王王座", boss: "深渊魔王", desc: "万阶尽头，等待篝火熄灭。", enemies: ["深渊侍从", "魔眼骑士", "王座执事"], hue: "#bb476d" }
  ];
  const EVOLUTIONS = ["初生体", "坚甲体", "狂暴体", "魔能体", "领主形态", "灾厄形态", "深渊形态", "王冠形态", "灭世形态", "终焉形态"];
  const RARITIES = [
    { name: "普通", color: "#a8b0bd", mult: 1, weight: 60 },
    { name: "稀有", color: "#5caeff", mult: 1.8, weight: 26 },
    { name: "史诗", color: "#b77aff", mult: 3.2, weight: 10 },
    { name: "传说", color: "#ffbd4a", mult: 5.7, weight: 3.3 },
    { name: "神话", color: "#ff6372", mult: 10, weight: .7 }
  ];
  const SLOT_NAMES = { weapon: "武器", armor: "护甲", relic: "饰品" };
  const SLOT_ICONS = { weapon: "⚔", armor: "◆", relic: "✦" };
  const HERO_DEFS = [
    { id: "yutong", name: "王宇彤", role: "铁壁守卫", roleClass: "tank", baseHp: 280, baseAtk: 11, baseDef: 15, interval: 1.25, color: "#e1b35b", skills: ["盾击", "守护壁垒", "威慑嘲讽", "不落城塞"] },
    { id: "wangshang", name: "王尚", role: "暗影游侠", roleClass: "dps", baseHp: 135, baseAtk: 25, baseDef: 6, interval: .78, color: "#e7606c", skills: ["弩射", "暗影连击", "弱点标记", "百矢夜幕"] },
    { id: "chongrui", name: "徐崇睿", role: "星辉祭司", roleClass: "support", baseHp: 170, baseAtk: 10, baseDef: 8, interval: 1.4, color: "#6edbd0", skills: ["星光弹", "星辉治愈", "勇气祝福", "命运回响"] }
  ];
  const TALENTS = {
    guard: { name: "守御", desc: "生命、护盾与减伤", color: "#e0ad55" },
    hunt: { name: "猎杀", desc: "攻击、暴击与Boss伤害", color: "#e05e69" },
    star: { name: "星辉", desc: "治疗、金币、经验与掉落", color: "#67d3ca" }
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const dom = {};
  let state = loadState();
  let runtime = createRuntime();
  let activeTab = "team";
  let drawerOpen = false;
  let lastFrame = performance.now();
  let lastRender = 0;
  let lastSave = performance.now();
  let sessionOpenAt = Date.now();

  function initialState() {
    return {
      version: SAVE_VERSION, stage: 1, bestStage: 1, gold: 40, dust: 0, embers: 0, totalKills: 0,
      rebirths: 0, speed: 1, completed: false, lastSavedAt: Date.now(), activeBossStage: 0,
      heroes: HERO_DEFS.map(() => ({ level: 1, xp: 0, training: 0, skillLevels: [1, 0, 0, 0], gear: { weapon: null, armor: null, relic: null } })),
      bag: [], talents: { guard: 0, hunt: 0, star: 0, guardCore: false, huntCore: false, starCore: false },
      autoTrain: { enabled: false, priority: "均衡" }, autoSalvage: { 普通: false, 稀有: false, 史诗: false },
      codex: { bosses: [], enemies: [], gear: [] }, firstZoneSeen: [0], firstBossSeen: [],
      settings: { showDamage: true, uiScale: 100, highContrast: false, reduceMotion: false, particles: true },
      guide: { step: 0, dismissed: false }
    };
  }

  function mergeState(saved) {
    const base = initialState();
    if (!saved || typeof saved !== "object") return base;
    const merged = { ...base, ...saved };
    merged.heroes = base.heroes.map((h, i) => ({ ...h, ...(saved.heroes?.[i] || {}), gear: { ...h.gear, ...(saved.heroes?.[i]?.gear || {}) } }));
    merged.talents = { ...base.talents, ...(saved.talents || {}) };
    merged.autoTrain = { ...base.autoTrain, ...(saved.autoTrain || {}) };
    merged.autoSalvage = { ...base.autoSalvage, ...(saved.autoSalvage || {}) };
    merged.codex = { ...base.codex, ...(saved.codex || {}) };
    merged.settings = { ...base.settings, ...(saved.settings || {}) };
    merged.guide = { ...base.guide, ...(saved.guide || {}) };
    merged.version = SAVE_VERSION;
    merged.stage = clamp(Math.floor(merged.stage || 1), 1, MAX_STAGE);
    merged.bestStage = clamp(Math.floor(merged.bestStage || 1), 1, MAX_STAGE);
    return merged;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (raw) {
        if ((parsed.version || 1) < SAVE_VERSION && !localStorage.getItem(BACKUP_KEY)) {
          try { localStorage.setItem(BACKUP_KEY, raw); }
          catch (backupError) { console.warn("升级前存档备份失败", backupError); }
        }
      }
      const loaded = mergeState(parsed);
      if (raw && loaded.lastSavedAt) {
        const seconds = Math.min(OFFLINE_CAP, Math.max(0, (Date.now() - loaded.lastSavedAt) / 1000));
        if (seconds > 3) {
          const rates = offlineRates(loaded);
          loaded.gold += rates.gold * seconds;
          loaded.heroes.forEach(h => addXpRaw(h, rates.xp * seconds));
          loaded.pendingOffline = { seconds, gold: rates.gold * seconds, xp: rates.xp * seconds };
        }
      }
      return loaded;
    } catch (error) {
      console.warn("存档读取失败", error);
      return initialState();
    }
  }

  function saveState(show = false) {
    state.lastSavedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      if (dom.saveState) dom.saveState.textContent = "已保存";
      if (show) toast("远征进度已保存");
    } catch (error) {
      if (dom.saveState) dom.saveState.textContent = "保存失败";
      toast("存档空间不足，请导出后清理", true);
    }
  }

  function createRuntime() {
    const r = {
      enemy: null, timer: 12, enemyAttack: 1.2, bossAttackCount: 0, retryAt: 0, retryRemaining: 0,
      battleStage: state.stage, stats: [], paused: false, pendingSpawn: false,
      heroes: HERO_DEFS.map(() => ({ hp: 1, maxHp: 1, energy: 0, attackCd: .2 + Math.random() * .5, skillCd: 2.2, shield: 0, alive: true }))
    };
    return r;
  }

  function init() {
    Object.assign(dom, {
      stage: $("#stageValue"), gold: $("#goldValue"), dust: $("#dustValue"), ember: $("#emberValue"),
      teamPower: $("#teamPower"), heroCards: $("#heroCards"), partySprites: $("#partySprites"),
      battlefield: $("#battlefield"), enemyUnit: $("#enemyUnit"), enemySprite: $("#enemySprite"),
      zoneIndex: $("#zoneIndex"), zoneName: $("#zoneName"), eliteMark: $("#eliteMark"), bossMark: $("#bossMark"),
      enemyName: $("#enemyName"), enemyHpBar: $("#enemyHpBar"), enemyHpText: $("#enemyHpText"), enemyTraits: $("#enemyTraits"), timer: $("#timerValue"),
      dps: $("#dpsValue"), heal: $("#healValue"), nextBossStage: $("#nextBossStage"), nextBossName: $("#nextBossName"), nextBossDesc: $("#nextBossDesc"),
      bossPortrait: $("#bossPortrait"), retryText: $("#retryText"), challengeBtn: $("#challengeBtn"), dropPreview: $("#dropPreview"),
      milestoneTitle: $("#milestoneTitle"), milestoneBar: $("#milestoneBar"), milestoneText: $("#milestoneText"), tabContent: $("#tabContent"),
      bagBadge: $("#bagBadge"), saveState: $("#saveState"), fx: $("#fxLayer"), damage: $("#damageLayer"),
      bossIntro: $("#bossIntro"), bossTitle: $("#bossTitle"), victory: $("#victoryOverlay"), modal: $("#modal"), modalBody: $("#modalBody"),
      sideDrawer: $("#sideDrawer"), drawerTitle: $("#drawerTitle"), drawerClose: $("#drawerClose"), drawerScrim: $("#drawerScrim"),
      bossWinChance: $("#bossWinChance"), guideTip: $("#guideTip")
    });
    applyDisplaySettings();
    buildSprites();
    bindEvents();
    spawnStage(state.stage, true);
    renderTab();
    render(true);
    if (state.pendingOffline) {
      const report = state.pendingOffline;
      delete state.pendingOffline;
      setTimeout(() => showOfflineReport(report), 350);
    }
    if (!state.guide.dismissed) setTimeout(showGuide, 900);
    setInterval(loop, 100);
    setInterval(() => saveState(false), 5000);
    window.addEventListener("beforeunload", () => saveState(false));
    // 不重置 lastFrame：后台标签页恢复时必须按真实经过时间补算战斗。
  }

  function buildSprites() {
    dom.partySprites.innerHTML = HERO_DEFS.map((hero, i) => `<div class="battle-hero hero-${i}" data-hero="${i}" style="background-image:url('assets-v2/heroes/${hero.id}-v2.png');--hero-color:${hero.color};background-position:0 0"></div>`).join("");
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const speed = event.target.closest("[data-speed]");
      if (speed && !speed.classList.contains("locked")) { state.speed = Number(speed.dataset.speed); render(); return; }
      const tab = event.target.closest("[data-tab]");
      if (tab) { openDrawer(tab.dataset.tab); return; }
      const action = event.target.closest("[data-action]");
      if (action) handleAction(action.dataset.action, action.dataset); 
    });
    $("#upgradeAllBtn").addEventListener("click", upgradeAll);
    $("#autoTrainBtn").addEventListener("click", toggleAutoTrain);
    dom.challengeBtn.addEventListener("click", immediateChallenge);
    dom.drawerClose.addEventListener("click", closeDrawer);
    dom.drawerScrim.addEventListener("click", closeDrawer);
    $("#modalClose").addEventListener("click", closeModal);
    dom.modal.addEventListener("click", e => { if (e.target === dom.modal) closeModal(); });
    window.addEventListener("keydown", e => { if (e.key === "Escape") { if (!dom.modal.classList.contains("hidden")) closeModal(); else closeDrawer(); } });
  }

  function openDrawer(tab = "team") {
    const titles = { team: "队伍详情", gear: "装备与背包", talent: "永久天赋", codex: "深渊图鉴", rebirth: "篝火重整", settings: "远征设置" };
    activeTab = tab;
    drawerOpen = true;
    dom.drawerTitle.textContent = titles[tab] || "远征整备";
    dom.sideDrawer.classList.add("open");
    dom.sideDrawer.setAttribute("aria-hidden", "false");
    dom.drawerScrim.classList.add("open");
    $$(".tab-btn").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
    renderTab();
  }

  function closeDrawer() {
    drawerOpen = false;
    dom.sideDrawer.classList.remove("open");
    dom.sideDrawer.setAttribute("aria-hidden", "true");
    dom.drawerScrim.classList.remove("open");
    $$(".tab-btn").forEach(button => button.classList.remove("active"));
  }

  function loop(now = performance.now()) {
    const elapsed = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!runtime.paused && !state.completed) {
      if (elapsed > 2) simulateBackground(elapsed * state.speed);
      else { maybeAutoChallenge(elapsed); simulateDetailed(Math.min(elapsed, .5) * state.speed); }
    }
    if (now - lastRender > 180) { render(); lastRender = now; }
    if (now - lastSave > 5000) { saveState(false); lastSave = now; }
  }

  function spawnStage(stage, fresh = false) {
    runtime.battleStage = clamp(stage, 1, MAX_STAGE);
    const zoneIndex = zoneOf(stage);
    const boss = stage % 100 === 0;
    const elite = !boss && stage % 10 === 0;
    const power = Math.pow(1.0052, stage - 1) * (1 + zoneIndex * .42);
    let hp = 115 * power * (boss ? 17 : elite ? 3.1 : 1);
    const atk = 10 * Math.pow(1.00485, stage - 1) * (boss ? 2.8 : elite ? 1.5 : 1);
    const evo = bossEvolution(stage);
    const enemyType = (stage - 1) % 3;
    runtime.enemy = { maxHp: hp, hp, atk, boss, elite, zoneIndex, evo, enemyType, debuff: 0 };
    runtime.timer = boss ? 30 : 12;
    runtime.enemyAttack = boss ? 1.05 : 1.35;
    runtime.bossAttackCount = 0;
    runtime.pendingSpawn = false;
    if (fresh || runtime.heroes.every(h => !h.alive)) resetPartyRuntime();
    updateEnemySprite();
    discoverEnemy();
    if (boss && !state.firstBossSeen.includes(stage)) {
      state.firstBossSeen.push(stage);
      showBossIntro(stage);
    }
    if (!state.firstZoneSeen.includes(zoneIndex)) {
      state.firstZoneSeen.push(zoneIndex);
      toast(`进入新区域：${ZONES[zoneIndex].name}`);
    }
  }

  function resetPartyRuntime() {
    runtime.heroes.forEach((hero, i) => {
      const stats = heroStats(i);
      hero.maxHp = stats.hp; hero.hp = stats.hp; hero.energy = 0; hero.attackCd = .2 + i * .2; hero.skillCd = 2 + i; hero.shield = 0; hero.alive = true;
    });
  }

  function simulateDetailed(dt) {
    if (!runtime.enemy || runtime.pendingSpawn) return;
    runtime.timer -= dt;
    runtime.enemyAttack -= dt;
    runtime.heroes.forEach((hero, i) => {
      if (!hero.alive) return;
      hero.attackCd -= dt;
      hero.skillCd -= dt;
      if (hero.skillCd <= 0 && state.heroes[i].skillLevels[1] > 0) castSkill(i);
      if (hero.energy >= 100 && state.heroes[i].skillLevels[3] > 0) castUltimate(i);
      if (hero.attackCd <= 0) heroAttack(i);
    });
    if (runtime.enemyAttack <= 0 && runtime.enemy.hp > 0) enemyAttack();
    if (runtime.timer <= 0 || runtime.heroes.every(h => !h.alive)) failStage();
    processAutoTrain(dt);
    trimStats();
  }

  function simulateBackground(seconds) {
    let remaining = seconds;
    let safety = 0;
    while (remaining > 0 && safety++ < 20000 && !state.completed) {
      if (state.activeBossStage && runtime.retryRemaining > 0) {
        const waitCombat = runtime.retryRemaining * state.speed;
        if (remaining < waitCombat) {
          runtime.retryRemaining -= remaining / state.speed;
          runtime.retryAt = Date.now() + runtime.retryRemaining * 1000;
          break;
        }
        remaining -= waitCombat;
        runtime.retryRemaining = 0;
        runtime.retryAt = 0;
        immediateChallenge();
        continue;
      }
      if (!runtime.enemy) spawnStage(state.stage, true);
      const dps = estimatedDps();
      const timeToKill = runtime.enemy.hp / Math.max(1, dps);
      const allowed = Math.min(remaining, runtime.timer);
      if (timeToKill <= allowed) {
        remaining -= timeToKill;
        runtime.timer -= timeToKill;
        runtime.enemy.hp = 0;
        winStage(true);
      } else {
        runtime.enemy.hp -= dps * allowed;
        runtime.timer -= allowed;
        remaining -= allowed;
        if (runtime.timer <= 0) { failStage(true); continue; }
      }
    }
  }

  function heroAttack(i) {
    const hero = runtime.heroes[i];
    const stats = heroStats(i);
    hero.attackCd += HERO_DEFS[i].interval / (1 + stats.haste);
    const crit = Math.random() < stats.crit;
    let damage = stats.atk * (.88 + Math.random() * .24) * (crit ? stats.critDmg : 1);
    if (runtime.enemy.boss) damage *= stats.bossDamage;
    if (runtime.enemy.debuff > 0) damage *= 1.16;
    dealDamage(damage, i, crit);
    hero.energy = Math.min(100, hero.energy + 12);
    setHeroAction(i, "attack");
  }

  function castSkill(i) {
    const hero = runtime.heroes[i];
    const level = Math.max(1, state.heroes[i].skillLevels[1]);
    hero.skillCd = i === 0 ? 8 : i === 1 ? 5 : 6;
    if (i === 0) {
      runtime.heroes.forEach((target, j) => { if (target.alive) target.shield += heroStats(0).hp * (.12 + level * .012); });
      toastMini("守护壁垒", 31, 37);
    } else if (i === 1) {
      const damage = heroStats(1).atk * (2.25 + level * .12);
      dealDamage(damage, i, Math.random() < heroStats(1).crit);
      runtime.enemy.debuff = 5;
    } else {
      const power = heroStats(2).heal * (1.9 + level * .1);
      const targetIndex = runtime.heroes.reduce((best, h, idx, arr) => h.alive && h.hp / h.maxHp < arr[best].hp / arr[best].maxHp ? idx : best, 0);
      healHero(targetIndex, power);
      runtime.heroes.forEach(h => { if (h.alive) h.energy = Math.min(100, h.energy + 8); });
    }
    setHeroAction(i, "skill");
    emitSkillFx(i, "skill");
  }

  function castUltimate(i) {
    const hero = runtime.heroes[i];
    hero.energy = 0;
    if (i === 0) {
      runtime.heroes.forEach(h => { if (h.alive) h.shield += heroStats(0).hp * .55; });
      toast("王宇彤释放「不落城塞」");
    } else if (i === 1) {
      dealDamage(heroStats(1).atk * 7.5, i, true);
      toast("王尚释放「百矢夜幕」");
    } else {
      const down = runtime.heroes.findIndex(h => !h.alive);
      if (down >= 0) {
        const stats = heroStats(down); runtime.heroes[down].alive = true; runtime.heroes[down].maxHp = stats.hp; runtime.heroes[down].hp = stats.hp * .45; runtime.heroes[down].shield = stats.hp * .2;
        setHeroAction(down, "idle"); toast(`徐崇睿以「命运回响」复活了${HERO_DEFS[down].name}`);
      } else runtime.heroes.forEach((h, idx) => healHero(idx, heroStats(2).heal * 2.8));
    }
    setHeroAction(i, "ultimate");
    emitSkillFx(i, "ultimate");
  }

  function enemyAttack() {
    const e = runtime.enemy;
    setEnemyAction("attack");
    runtime.enemyAttack += e.boss ? 1.05 : 1.35;
    runtime.bossAttackCount++;
    const alive = runtime.heroes.map((h, i) => h.alive ? i : -1).filter(i => i >= 0);
    if (!alive.length) return;
    const aoe = e.boss && runtime.bossAttackCount % 4 === 0;
    const targets = aoe ? alive : [alive.includes(0) ? 0 : alive[Math.floor(Math.random() * alive.length)]];
    targets.forEach(i => {
      const target = runtime.heroes[i];
      const stats = heroStats(i);
      let damage = Math.max(1, e.atk * (.9 + Math.random() * .2) - stats.def * .65);
      if (runtime.enemy.debuff > 0) damage *= .82;
      if (state.talents.guardCore) damage *= .88;
      if (target.shield > 0) { const absorbed = Math.min(target.shield, damage); target.shield -= absorbed; damage -= absorbed; }
      target.hp = Math.max(0, target.hp - damage);
      floatNumber(format(damage), 18 + i * 11, 55, false, false);
      setHeroAction(i, "hit");
      if (target.hp <= 0) { target.alive = false; setHeroAction(i, "down"); }
    });
    if (e.debuff > 0) e.debuff -= e.boss ? 1.05 : 1.35;
    dom.enemyUnit.classList.remove("hit");
  }

  function dealDamage(amount, heroIndex, crit = false) {
    if (!runtime.enemy || runtime.enemy.hp <= 0) return;
    const damage = Math.min(runtime.enemy.hp, Math.max(1, amount));
    runtime.enemy.hp -= damage;
    runtime.stats.push({ at: Date.now(), type: "damage", value: damage });
    if (state.settings.showDamage) floatNumber(format(damage), 72 + Math.random() * 10, 34 + Math.random() * 16, crit, false);
    emitHitFx(heroIndex, crit);
    dom.enemyUnit.classList.remove("hit"); void dom.enemyUnit.offsetWidth; dom.enemyUnit.classList.add("hit");
    if (runtime.enemy.hp <= 0) winStage(false);
  }

  function healHero(i, amount) {
    const hero = runtime.heroes[i];
    if (!hero.alive) return;
    const actual = Math.min(amount, hero.maxHp - hero.hp);
    hero.hp += actual;
    runtime.stats.push({ at: Date.now(), type: "heal", value: actual });
    if (actual > 0 && state.settings.showDamage) floatNumber(`+${format(actual)}`, 19 + i * 11, 48, false, true);
  }

  function winStage(background = false) {
    const defeated = runtime.enemy;
    if (!defeated) return;
    runtime.pendingSpawn = true;
    state.totalKills++;
    const rewardMult = 1 + state.talents.star * .04 + (state.talents.starCore ? .2 : 0);
    const gold = (12 + runtime.battleStage * .85) * (defeated.boss ? 12 : defeated.elite ? 3 : 1) * rewardMult;
    const xp = (8 + runtime.battleStage * .48) * (defeated.boss ? 8 : defeated.elite ? 2 : 1) * rewardMult;
    state.gold += gold;
    state.heroes.forEach(h => addXpRaw(h, xp));
    if (defeated.boss) {
      const first = !state.codex.bosses.includes(runtime.battleStage);
      if (first) { state.codex.bosses.push(runtime.battleStage); state.embers += 2 + Math.floor(runtime.battleStage / 500); generateGear(true); toast(`首胜！获得灵魂余烬与保底装备`); }
      else if (Math.random() < .08) generateGear(false);
    } else if (Math.random() < (.075 + state.talents.star * .003)) generateGear(false);
    if (background) advanceAfterWin();
    else {
      dom.enemyUnit.classList.add("dead");
      setTimeout(() => { dom.enemyUnit.classList.remove("dead"); advanceAfterWin(); }, 480 / state.speed);
    }
  }

  function advanceAfterWin() {
    runtime.pendingSpawn = false;
    if (runtime.battleStage >= MAX_STAGE) {
      state.stage = MAX_STAGE; state.bestStage = MAX_STAGE; state.completed = true; dom.victory.classList.remove("hidden"); saveState(); return;
    }
    state.bestStage = Math.max(state.bestStage, runtime.battleStage);
    state.stage = runtime.battleStage + 1;
    state.activeBossStage = 0; runtime.retryAt = 0; runtime.retryRemaining = 0;
    spawnStage(state.stage, false);
  }

  function failStage(background = false) {
    if (runtime.pendingSpawn) return;
    const failedStage = runtime.battleStage;
    const isBoss = runtime.enemy?.boss;
    runtime.pendingSpawn = true;
    if (isBoss) {
      state.activeBossStage = failedStage;
      runtime.retryAt = Date.now() + 30000;
      runtime.retryRemaining = 30;
      state.stage = Math.max(1, failedStage - 1);
      if (!background) toast(`${bossName(failedStage)}挑战失败，退回前一关整备`, true);
    } else state.stage = Math.max(1, failedStage);
    resetPartyRuntime();
    runtime.pendingSpawn = false;
    spawnStage(state.stage, true);
  }

  function immediateChallenge() {
    if (!state.activeBossStage) return;
    runtime.retryAt = 0; runtime.retryRemaining = 0; state.stage = state.activeBossStage; resetPartyRuntime(); spawnStage(state.stage, true); toast("立即重返Boss战");
  }

  function maybeAutoChallenge(realSeconds = 0) {
    if (!state.activeBossStage || runtime.battleStage === state.activeBossStage) return;
    runtime.retryRemaining = Math.max(0, runtime.retryRemaining - realSeconds);
    runtime.retryAt = Date.now() + runtime.retryRemaining * 1000;
    if (runtime.retryRemaining <= 0) immediateChallenge();
  }

  function processAutoTrain(dt) {
    if (!state.autoTrain.enabled || state.bestStage < 500) return;
    state.autoTrainClock = (state.autoTrainClock || 0) + dt;
    if (state.autoTrainClock < 2) return;
    state.autoTrainClock = 0;
    const order = state.autoTrain.priority === "前排生存" ? [0,2,1] : state.autoTrain.priority === "输出伤害" ? [1,0,2] : state.autoTrain.priority === "辅助治疗" ? [2,0,1] : [0,1,2];
    for (const i of order) if (buyTraining(i, false)) break;
  }

  function heroStats(i) {
    const def = HERO_DEFS[i], hero = state.heroes[i];
    const levelMult = 1 + (hero.level - 1) * .075;
    const trainMult = 1 + hero.training * .09;
    let atk = def.baseAtk * levelMult * trainMult;
    let hp = def.baseHp * levelMult * trainMult;
    let defense = def.baseDef * (1 + (hero.level - 1) * .055) * (1 + hero.training * .065);
    let crit = i === 1 ? .14 : .05, critDmg = i === 1 ? 1.85 : 1.55, heal = i === 2 ? atk * 2.3 : atk;
    Object.values(hero.gear).filter(Boolean).forEach(g => {
      const value = gearValue(g);
      if (g.slot === "weapon") atk += value;
      if (g.slot === "armor") { hp += value * 8; defense += value * .45; }
      if (g.slot === "relic") { crit += value * .00065; heal += value * .75; }
    });
    hp *= 1 + state.talents.guard * .06; defense *= 1 + state.talents.guard * .04;
    atk *= 1 + state.talents.hunt * .055;
    heal *= 1 + state.talents.star * .055;
    return { hp, atk, def: defense, crit: Math.min(.65, crit + state.talents.hunt * .006), critDmg, heal, haste: Math.min(.6, hero.level * .0007), bossDamage: 1 + state.talents.hunt * .035 + (state.talents.huntCore ? .25 : 0) };
  }

  function teamPower() { return HERO_DEFS.reduce((sum, _, i) => { const s = heroStats(i); return sum + s.atk * 8 + s.hp * .8 + s.def * 10; }, 0); }
  function estimatedDps() { return HERO_DEFS.reduce((sum, def, i) => { const s = heroStats(i); return sum + s.atk / def.interval * (1 + s.crit * (s.critDmg - 1)) * (i === 1 ? 1.28 : 1.12); }, 0) * (runtime.enemy?.boss ? (1 + state.talents.hunt * .035) : 1); }
  function offlineRates(s = state) { const floor = Math.max(1, Math.min(s.stage, s.bestStage)); const star = s.talents?.star || 0; return { gold: (.7 + floor * .025) * (1 + star * .04), xp: (.42 + floor * .014) * (1 + star * .04) }; }

  function addXpRaw(hero, amount) {
    hero.xp += amount;
    let needed = xpNeeded(hero.level);
    while (hero.xp >= needed) { hero.xp -= needed; hero.level++; unlockSkills(hero); needed = xpNeeded(hero.level); }
  }
  function unlockSkills(hero) {
    if (hero.level >= 10 && hero.skillLevels[1] === 0) hero.skillLevels[1] = 1;
    if (hero.level >= 25 && hero.skillLevels[2] === 0) hero.skillLevels[2] = 1;
    if (hero.level >= 50 && hero.skillLevels[3] === 0) hero.skillLevels[3] = 1;
  }
  function xpNeeded(level) { return 55 * Math.pow(1.145, level - 1); }
  function trainCost(i) { const h = state.heroes[i]; return Math.floor(25 * Math.pow(1.18, h.training) * (1 + i * .04)); }
  function skillCost(i, skill) { const level = state.heroes[i].skillLevels[skill]; return Math.floor(70 * Math.pow(1.42, level) * (1 + skill * .7)); }
  function buyTraining(i, notify = true) { const cost = trainCost(i); if (state.gold < cost) { if (notify) toast("金币不足", true); return false; } state.gold -= cost; state.heroes[i].training++; resetPartyRuntime(); renderTab(); return true; }
  function upgradeAll() { let bought = 0; for (let round = 0; round < 50; round++) { const i = state.heroes.map((h,j) => ({j,n:h.training})).sort((a,b)=>a.n-b.n)[0].j; if (!buyTraining(i,false)) break; bought++; } if (!bought) toast("金币不足", true); else toast(`完成${bought}次全队培养`); }
  function toggleAutoTrain() { if (state.bestStage < 500) { toast("通过第500关后解锁自动培养", true); return; } state.autoTrain.enabled = !state.autoTrain.enabled; toast(state.autoTrain.enabled ? "自动培养已开启" : "自动培养已关闭"); render(); }

  function generateGear(guaranteed = false) {
    const stage = runtime.battleStage;
    const slot = ["weapon","armor","relic"][Math.floor(Math.random()*3)];
    const floorRarity = guaranteed ? Math.min(4, Math.floor((stage - 1) / 2000)) : 0;
    const roll = Math.random() * 100;
    let acc = 0, rarityIndex = 0;
    for (let i=0;i<RARITIES.length;i++){acc+=RARITIES[i].weight;if(roll<=acc){rarityIndex=i;break;}}
    rarityIndex = Math.max(floorRarity, rarityIndex);
    const rarity = RARITIES[rarityIndex];
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, slot, rarity: rarity.name, rarityIndex, base: Math.round((5 + stage * .18) * rarity.mult * (.86 + Math.random() * .28)), enhance: 0, locked: false, stage };
    if (!state.codex.gear.includes(rarity.name)) state.codex.gear.push(rarity.name);
    lootBurst(rarityIndex,slot);
    if (state.autoSalvage[rarity.name]) { state.dust += salvageValue(item); toastMini(`自动分解 ${rarity.name}${SLOT_NAMES[slot]}`, 71, 77); }
    else { state.bag.unshift(item); toast(`获得${rarity.name}${SLOT_NAMES[slot]}`); }
  }
  function gearValue(g) { return g.base * (1 + g.enhance * .12); }
  function salvageValue(g) { return Math.floor(g.base * .38 + g.enhance * g.base * .08); }
  function enhanceCost(g) { return Math.floor((12 + g.base * .22) * Math.pow(1.22, g.enhance)); }

  function equipBest(heroIndex) {
    ["weapon","armor","relic"].forEach(slot => {
      const current = state.heroes[heroIndex].gear[slot];
      const candidates = state.bag.filter(g => g.slot === slot).concat(current ? [current] : []).sort((a,b)=>gearValue(b)-gearValue(a));
      const best = candidates[0]; if (!best || best === current) return;
      state.bag = state.bag.filter(g => g.id !== best.id);
      if (current) state.bag.unshift(current);
      state.heroes[heroIndex].gear[slot] = best;
    });
    resetPartyRuntime(); renderTab(); toast(`${HERO_DEFS[heroIndex].name}已换上最高战力装备`);
  }

  function salvageItem(id) {
    const idx = state.bag.findIndex(g => g.id === id); if (idx < 0) return;
    const item = state.bag[idx]; if (item.locked) { toast("已锁定装备无法分解", true); return; }
    state.dust += salvageValue(item); state.bag.splice(idx,1); renderTab();
  }
  function enhanceEquipped(heroIndex, slot) {
    const item = state.heroes[heroIndex].gear[slot]; if (!item) return;
    if (item.enhance >= 20) { toast("装备已强化至+20"); return; }
    const cost = enhanceCost(item); if (state.dust < cost) { toast("强化粉尘不足", true); return; }
    state.dust -= cost; item.enhance++; resetPartyRuntime(); renderTab();
  }

  function performRebirth() {
    if (state.bestStage < 100) { toast("通过第100关后才能篝火重整", true); return; }
    const reward = rebirthReward();
    state.embers += reward; state.rebirths++; state.stage = 1; state.gold = 40;
    state.heroes.forEach(h => { h.level = 1; h.xp = 0; h.training = 0; h.skillLevels = [1,0,0,0]; });
    state.activeBossStage = 0; runtime.retryAt = 0; runtime.retryRemaining = 0; state.completed = false;
    resetPartyRuntime(); spawnStage(1,true); saveState(); closeModal(); renderTab(); toast(`篝火重整完成，获得${reward}灵魂余烬`);
  }
  function rebirthReward() { return Math.max(1, Math.floor(Math.pow(state.bestStage / 100, .72) * 5)); }
  function talentCost(branch) { return 1 + state.talents[branch]; }
  function buyTalent(branch) { const level=state.talents[branch]; if(level>=10)return;const cost=talentCost(branch);if(state.embers<cost){toast("灵魂余烬不足",true);return;}state.embers-=cost;state.talents[branch]++;resetPartyRuntime();renderTab(); }
  function buyCore(branch) { if(state.talents[branch]<10)return;const key=`${branch}Core`;if(state.talents[key])return;if(state.embers<20){toast("核心节点需要20余烬",true);return;}state.embers-=20;state.talents[key]=true;resetPartyRuntime();renderTab(); }
  function resetTalents(){let refund=0;Object.keys(TALENTS).forEach(k=>{const n=state.talents[k];refund+=n*(n+1)/2;if(state.talents[`${k}Core`])refund+=20;state.talents[k]=0;state.talents[`${k}Core`]=false;});state.embers+=refund;resetPartyRuntime();renderTab();toast(`已返还${refund}灵魂余烬`);}

  function render(force = false) {
    if (!dom.stage) return;
    const zoneIndex = zoneOf(runtime.battleStage), zone = ZONES[zoneIndex], enemy = runtime.enemy;
    dom.stage.textContent = `${runtime.battleStage} / ${MAX_STAGE}`;
    dom.gold.textContent = format(state.gold); dom.dust.textContent = format(state.dust); dom.ember.textContent = format(state.embers);
    dom.teamPower.textContent = `战力 ${format(teamPower())}`;
    dom.zoneIndex.textContent = `区域 ${String(zoneIndex+1).padStart(2,"0")}`; dom.zoneName.textContent = zone.name;
    dom.battlefield.style.setProperty("--zone-bg", `url('assets/backgrounds/zone-${String(zoneIndex+1).padStart(2,"0")}.png')`);
    dom.eliteMark.textContent = enemy?.elite ? "精英" : ""; dom.eliteMark.classList.toggle("hidden", !enemy?.elite);
    dom.bossMark.textContent = enemy?.boss ? "BOSS" : ""; dom.bossMark.classList.toggle("hidden", !enemy?.boss);
    if (enemy) {
      dom.enemyName.textContent = enemy.boss ? bossName(runtime.battleStage) : zone.enemies[enemy.enemyType];
      dom.enemyHpBar.style.width = `${Math.max(0, enemy.hp/enemy.maxHp*100)}%`;
      dom.enemyHpText.textContent = `${format(Math.max(0,enemy.hp))} / ${format(enemy.maxHp)}`;
      dom.enemyTraits.textContent = enemy.boss ? `Boss · 进化${enemy.evo+1}` : enemy.elite ? "精英 · 强化掉落" : "普通";
      dom.timer.textContent = `${Math.max(0,runtime.timer).toFixed(1)}s`;
    }
    renderHeroes(); renderCombatStats(); renderProgress(); renderSpeed();
    if (drawerOpen && (force || activeTab === "team")) renderTab();
    dom.bagBadge.textContent = state.bag.length; dom.bagBadge.classList.toggle("hidden", !state.bag.length);
  }

  function renderHeroes() {
    dom.heroCards.innerHTML = HERO_DEFS.map((def,i)=>{
      const h=state.heroes[i],r=runtime.heroes[i],s=heroStats(i),xpPct=h.xp/xpNeeded(h.level)*100;
      return `<article class="hero-card ${def.roleClass}" data-action="open-hero" data-hero="${i}" title="点击查看详情 · 攻击 ${format(s.atk)} · 防御 ${format(s.def)} · 暴击 ${(s.crit*100).toFixed(1)}%">
        <div class="hero-avatar" style="background-image:url('assets-v2/heroes/${def.id}-v2.png')"></div>
        <h3>${def.name}<span>${def.role}</span></h3><span class="hero-level">Lv.${h.level}</span>
        <div class="mini-bars"><div class="mini-track"><div class="mini-fill hp" style="width:${r.alive?r.hp/r.maxHp*100:0}%"></div></div><div class="mini-track"><div class="mini-fill energy" style="width:${r.energy}%"></div></div></div>
        <div class="hero-stats"><span>生命 ${format(r.hp)}/${format(r.maxHp)}</span><span>训练 +${h.training}</span></div>
        <button class="hero-upgrade" data-action="train" data-hero="${i}">培养 · ${format(trainCost(i))}金币</button>
      </article>`}).join("");
    const autoBtn=$("#autoTrainBtn");autoBtn.classList.toggle("locked",state.bestStage<500);autoBtn.textContent=state.bestStage<500?"自动培养 · 500关解锁":`自动培养 · ${state.autoTrain.enabled?"开启":"关闭"}`;
  }

  function renderCombatStats(){trimStats();const damage=runtime.stats.filter(x=>x.type==="damage").reduce((s,x)=>s+x.value,0),heal=runtime.stats.filter(x=>x.type==="heal").reduce((s,x)=>s+x.value,0);dom.dps.textContent=format(damage/30);dom.heal.textContent=format(heal/30);}
  function trimStats(){const cutoff=Date.now()-30000;runtime.stats=runtime.stats.filter(x=>x.at>=cutoff);}

  function renderProgress(){
    const nextBoss=Math.min(MAX_STAGE,Math.ceil(runtime.battleStage/100)*100),zone=ZONES[zoneOf(nextBoss)],evo=bossEvolution(nextBoss);
    dom.nextBossStage.textContent=`第${nextBoss}关`;dom.nextBossName.textContent=`${zone.boss} · ${EVOLUTIONS[evo]}`;dom.nextBossDesc.textContent=zone.desc;
    setAtlasPosition(dom.bossPortrait,`assets/bosses/family-${String(zoneOf(nextBoss)+1).padStart(2,"0")}.png`,evo,5,2);
    if(state.activeBossStage){const sec=Math.max(0,Math.ceil((runtime.retryAt-Date.now())/1000));dom.retryText.textContent=sec?`${sec}秒后自动挑战`:"准备重返Boss战";dom.challengeBtn.disabled=false;}else{dom.retryText.textContent="尚未遭遇";dom.challengeBtn.disabled=true;}
    dom.dropPreview.innerHTML=[["weapon","武器"],["armor","护甲"],["relic","饰品"]].map(([slot,name])=>`<div class="drop-slot"><b class="gear-icon" style="margin:auto;${gearIconStyle(slot,zoneOf(nextBoss)%5)}"></b>${name}</div>`).join("");
    const bossPower=Math.pow(1.0052,nextBoss-1)*(1+zoneOf(nextBoss)*.42),bossHp=115*bossPower*17;
    const ratio=estimatedDps()*30*(1+state.talents.hunt*.035)/bossHp;
    const winChance=Math.round(clamp(100/(1+Math.exp(-(ratio-1)*3)),3,99));
    dom.bossWinChance.textContent=`预计胜率 · ${winChance}%`;
    dom.bossWinChance.style.color=winChance>=70?"var(--good)":winChance>=40?"var(--gold)":"var(--danger)";
    let target=100,title="第100关 · 篝火重整";if(state.bestStage>=100&&state.bestStage<500){target=500;title="第500关 · 自动培养"}else if(state.bestStage>=500&&state.bestStage<1000){target=1000;title="第1000关 · 四倍速"}else if(state.bestStage>=1000){target=Math.min(MAX_STAGE,Math.ceil((state.bestStage+1)/1000)*1000);title=target===MAX_STAGE?"第10000关 · 永恒篝火":`第${target}关 · 新区域`;}
    const start=target<=100?0:target- (target>=1000?1000:target===500?400:500);const pct=clamp((state.bestStage-start)/(target-start)*100,0,100);dom.milestoneTitle.textContent=title;dom.milestoneBar.style.width=`${pct}%`;dom.milestoneText.textContent=state.bestStage>=MAX_STAGE?"万阶远征已经完成。":`再推进${Math.max(0,target-state.bestStage)}关。`;
  }
  function renderSpeed(){const max=state.bestStage>=1000?4:state.bestStage>=100?2:1;if(state.speed>max)state.speed=max;$$('[data-speed]').forEach(b=>{const n=Number(b.dataset.speed);b.classList.toggle('locked',n>max);b.classList.toggle('active',n===state.speed);});}

  function renderTab(){
    if(!dom.tabContent)return;
    if(activeTab==="team")renderTeamTab();
    if(activeTab==="gear")renderGearTab();
    if(activeTab==="talent")renderTalentTab();
    if(activeTab==="codex")renderCodexTab();
    if(activeTab==="rebirth")renderRebirthTab();
    if(activeTab==="settings")renderSettingsTab();
  }
  function renderTeamTab(){dom.tabContent.innerHTML=`<div class="tab-grid">${HERO_DEFS.map((def,i)=>{const h=state.heroes[i],s=heroStats(i);return`<div class="info-card"><h3>${def.name} · ${def.role}</h3><p>攻击 <strong>${format(s.atk)}</strong>　生命 <strong>${format(s.hp)}</strong>　防御 <strong>${format(s.def)}</strong></p>${def.skills.map((name,j)=>`<div class="skill-line"><span>${name} · ${j===0?"基础":`Lv.${h.skillLevels[j]}`}${h.skillLevels[j]===0?`（${[0,10,25,50][j]}级解锁）`:""}</span>${j?`<button class="inline-btn" data-action="skill" data-hero="${i}" data-skill="${j}" ${h.skillLevels[j]===0?"disabled":""}>升级 ${format(skillCost(i,j))}</button>`:""}</div>`).join("")}</div>`}).join("")}</div>`;}
  function renderGearTab(){
    const equipped=HERO_DEFS.map((def,i)=>`<div class="gear-column"><h3>${def.name}<button class="inline-btn" style="float:right" data-action="equip-best" data-hero="${i}">一键换装</button></h3>${["weapon","armor","relic"].map(slot=>{const g=state.heroes[i].gear[slot];return`<div class="gear-item"><div class="gear-icon ${g?`rarity-${g.rarity}`:"empty"}" style="${gearIconStyle(slot,g?.rarityIndex||0)}"></div><div>${g?`${g.rarity}${SLOT_NAMES[slot]} +${g.enhance}<small>战力 ${format(gearValue(g))}</small>`:`空${SLOT_NAMES[slot]}`}</div>${g?`<button class="inline-btn" data-action="enhance" data-hero="${i}" data-slot="${slot}">${g.enhance>=20?"已满":`${format(enhanceCost(g))}粉尘`}</button>`:""}</div>`}).join("")}</div>`).join("");
    const bag=state.bag.slice(0,18).map(g=>`<div class="gear-item"><div class="gear-icon rarity-${g.rarity}" style="${gearIconStyle(g.slot,g.rarityIndex)}"></div><div>${g.rarity}${SLOT_NAMES[g.slot]} +${g.enhance}<small>战力 ${format(gearValue(g))} · ${g.locked?"已锁定":"未锁定"}</small></div><span><button class="inline-btn" data-action="lock" data-id="${g.id}">${g.locked?"解锁":"锁定"}</button> <button class="inline-btn" data-action="salvage" data-id="${g.id}">分解</button></span></div>`).join("")||`<p>背包为空。击败敌人会随机获得装备。</p>`;
    dom.tabContent.innerHTML=`<div class="gear-grid">${equipped}</div><div class="info-card" style="margin-top:10px"><h3>无限背包 · ${state.bag.length}件</h3>${bag}</div>`;
  }
  function renderTalentTab(){dom.tabContent.innerHTML=`<div class="talent-layout">${Object.entries(TALENTS).map(([key,t])=>`<div class="talent-branch" style="border-color:${t.color}55"><h3 style="color:${t.color}">${t.name}</h3><small>${t.desc}</small><div class="talent-nodes">${Array.from({length:10},(_,i)=>`<button class="talent-node ${i<state.talents[key]?"on":""}" data-action="talent" data-branch="${key}" ${i>state.talents[key]?"disabled":""}>${i+1}</button>`).join("")}<button class="talent-node core ${state.talents[key+"Core"]?"on":""}" data-action="talent-core" data-branch="${key}" ${state.talents[key]<10?"disabled":""}>核心节点 · 20余烬</button></div></div>`).join("")}</div><button class="inline-btn" style="margin-top:10px" data-action="talent-reset">免费重置并返还全部余烬</button>`;}
  function renderCodexTab(){const entries=[];for(let i=1;i<=100;i++){const stage=i*100,seen=state.codex.bosses.includes(stage);entries.push(`<div class="codex-entry ${seen?"seen":""}"><b>${seen?bossName(stage):"???"}</b><span>第${stage}关</span></div>`)}dom.tabContent.innerHTML=`<div class="subheading">Boss图鉴 · ${state.codex.bosses.length}/100</div><div class="codex-grid">${entries.join("")}</div>`;}
  function renderRebirthTab(){const can=state.bestStage>=100;dom.tabContent.innerHTML=`<div class="settings-grid"><div class="setting-card"><h3>篝火重整</h3><p>返回第1关；重置金币、角色等级、技能等级与培养。装备、图鉴、灵魂余烬、永久天赋和历史最高关卡全部保留。</p><p>本次可获得：<strong>${rebirthReward()} 灵魂余烬</strong></p><button class="primary-btn" style="width:180px" data-action="rebirth-open" ${can?"":"disabled"}>${can?"点燃重整篝火":"第100关后解锁"}</button></div><div class="setting-card"><h3>远征记录</h3><p>历史最高：第${state.bestStage}关</p><p>重整次数：${state.rebirths}</p><p>累计击杀：${format(state.totalKills)}</p><p>当前倍速：${state.speed}×</p></div></div>`;}
  function renderSettingsTab(){
    const backupReady=Boolean(localStorage.getItem(BACKUP_KEY));
    dom.tabContent.innerHTML=`<div class="settings-grid">
      <div class="setting-card"><h3>界面与性能</h3>
        <p>界面缩放</p><div class="setting-actions">${[90,100,110,125].map(x=>`<button class="inline-btn" data-action="ui-scale" data-value="${x}" ${state.settings.uiScale===x?"disabled":""}>${x}%</button>`).join("")}</div>
        <div class="setting-row"><span>高对比度</span><button class="inline-btn" data-action="contrast-toggle">${state.settings.highContrast?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>减少动态效果</span><button class="inline-btn" data-action="motion-toggle">${state.settings.reduceMotion?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>环境粒子</span><button class="inline-btn" data-action="particles-toggle">${state.settings.particles?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>伤害与治疗数字</span><button class="inline-btn" data-action="damage-toggle">${state.settings.showDamage?"显示":"隐藏"}</button></div>
      </div>
      <div class="setting-card"><h3>自动规则</h3><p>自动培养优先级</p><div class="setting-actions">${["均衡","前排生存","输出伤害","辅助治疗"].map(x=>`<button class="inline-btn" data-action="priority" data-value="${x}" ${state.autoTrain.priority===x?"disabled":""}>${x}</button>`).join("")}</div><p>自动分解</p><div class="setting-actions">${["普通","稀有","史诗"].map(x=>`<button class="inline-btn rarity-${x}" data-action="auto-salvage" data-value="${x}">${x}：${state.autoSalvage[x]?"开启":"关闭"}</button>`).join("")}</div></div>
      <div class="setting-card"><h3>存档管理</h3><p>每5秒及重大操作后自动保存，本地存档不会上传。升级前的旧存档会保留一份只读备份。</p><div class="setting-actions"><button class="inline-btn" data-action="save">立即保存</button><button class="inline-btn" data-action="export">导出当前存档</button><button class="inline-btn" data-action="download-backup" ${backupReady?"":"disabled"}>下载升级前备份</button><button class="inline-btn" data-action="import">导入存档</button><button class="inline-btn danger-btn" data-action="clear-open">清空进度</button></div></div>
      <div class="setting-card"><h3>兼容说明</h3><p>界面版本 v${SAVE_VERSION}。角色、装备、关卡、图鉴与离线收益全部沿用旧存档；关闭网页期间仍只累计金币和经验，不推进关卡。</p><button class="inline-btn" data-action="guide-reset">重新查看操作提示</button></div>
    </div>`;
  }

  function handleAction(action,data){
    if(action==="train")buyTraining(Number(data.hero));
    if(action==="skill"){const i=Number(data.hero),j=Number(data.skill),cost=skillCost(i,j);if(state.gold<cost)toast("金币不足",true);else{state.gold-=cost;state.heroes[i].skillLevels[j]++;renderTab();}}
    if(action==="equip-best")equipBest(Number(data.hero));
    if(action==="salvage")salvageItem(data.id);
    if(action==="lock"){const g=state.bag.find(x=>x.id===data.id);if(g){g.locked=!g.locked;renderTab();}}
    if(action==="enhance")enhanceEquipped(Number(data.hero),data.slot);
    if(action==="talent")buyTalent(data.branch);
    if(action==="talent-core")buyCore(data.branch);
    if(action==="talent-reset")resetTalents();
    if(action==="priority"){state.autoTrain.priority=data.value;renderTab();}
    if(action==="auto-salvage"){state.autoSalvage[data.value]=!state.autoSalvage[data.value];renderTab();}
    if(action==="save")saveState(true);
    if(action==="export")exportSave();
    if(action==="copy-save"){const text=$("#saveText")?.value||"";navigator.clipboard?.writeText(text).then(()=>toast("存档已复制到剪贴板")).catch(()=>toast("请手动选择并复制文本",true));}
    if(action==="import")importSaveModal();
    if(action==="clear-open")clearSaveModal();
    if(action==="clear-confirm"){localStorage.removeItem(SAVE_KEY);location.reload();}
    if(action==="import-confirm")importSave();
    if(action==="rebirth-open")rebirthModal();
    if(action==="rebirth-confirm")performRebirth();
    if(action==="open-hero")openDrawer("team");
    if(action==="ui-scale"){state.settings.uiScale=clamp(Number(data.value)||100,90,125);applyDisplaySettings();renderTab();saveState();}
    if(action==="contrast-toggle"){state.settings.highContrast=!state.settings.highContrast;applyDisplaySettings();renderTab();saveState();}
    if(action==="motion-toggle"){state.settings.reduceMotion=!state.settings.reduceMotion;applyDisplaySettings();renderTab();saveState();}
    if(action==="particles-toggle"){state.settings.particles=!state.settings.particles;applyDisplaySettings();renderTab();saveState();}
    if(action==="damage-toggle"){state.settings.showDamage=!state.settings.showDamage;renderTab();saveState();}
    if(action==="download-backup")downloadBackup();
    if(action==="guide-close"){state.guide.dismissed=true;dom.guideTip.classList.add("hidden");saveState();}
    if(action==="guide-reset"){state.guide.dismissed=false;showGuide();}
  }

  function applyDisplaySettings(){
    const scale=clamp(Number(state.settings.uiScale)||100,90,125);
    document.documentElement?.style?.setProperty("--ui-scale",String(scale/100));
    document.body?.classList?.toggle("high-contrast",Boolean(state.settings.highContrast));
    document.body?.classList?.toggle("reduce-motion",Boolean(state.settings.reduceMotion));
    document.body?.classList?.toggle("no-particles",state.settings.particles===false);
  }

  function showGuide(){
    dom.guideTip.innerHTML=`战斗会自动进行。使用底部功能栏查看队伍、装备与天赋；Boss失败后可立即重试。<button class="inline-btn" data-action="guide-close">知道了</button>`;
    dom.guideTip.classList.remove("hidden");
  }

  function downloadBackup(){
    const raw=localStorage.getItem(BACKUP_KEY);
    if(!raw){toast("没有可下载的升级前备份",true);return;}
    const blob=new Blob([raw],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=`万阶深渊-升级前备份-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    toast("升级前备份已下载");
  }

  function updateEnemySprite(){
    const e=runtime.enemy;if(!e)return;
    dom.enemyUnit.classList.toggle("final-boss",e.boss&&runtime.battleStage===MAX_STAGE);
    if(e.boss){
      const file=`assets/bosses/family-${String(e.zoneIndex+1).padStart(2,"0")}.png`;
      dom.enemySprite.classList.remove("enemy-animated","enemy-attacking");
      setAtlasPosition(dom.enemySprite,file,e.evo,5,2);
    }else{
      const file=`assets-v2/enemies/zone-${String(e.zoneIndex+1).padStart(2,"0")}-v2.png`;
      dom.enemySprite.style.backgroundImage=`url('${file}')`;
      dom.enemySprite.style.backgroundSize="400% 600%";
      dom.enemySprite.classList.add("enemy-animated");
      setEnemyAction("idle");
    }
    dom.enemyUnit.style.width=e.boss?"clamp(260px,16vw,390px)":e.elite?"clamp(205px,12vw,290px)":"clamp(175px,10vw,250px)";
    dom.enemyUnit.style.height=e.boss?"clamp(270px,30vh,420px)":e.elite?"clamp(210px,24vh,320px)":"clamp(180px,21vh,290px)";
  }

  function setEnemyAction(action){
    const e=runtime.enemy;if(!e)return;
    if(e.boss){
      if(action==="attack"){
        dom.enemyUnit.classList.remove("boss-attacking");void dom.enemyUnit.offsetWidth;dom.enemyUnit.classList.add("boss-attacking");
        dom.battlefield.classList.remove("camera-kick");void dom.battlefield.offsetWidth;dom.battlefield.classList.add("camera-kick");
        setTimeout(()=>{dom.enemyUnit.classList.remove("boss-attacking");dom.battlefield.classList.remove("camera-kick");},runtime.battleStage===MAX_STAGE?760:480);
      }
      return;
    }
    const row=e.enemyType*2+(action==="attack"?1:0);
    dom.enemySprite.style.backgroundPosition=`0% ${row/5*100}%`;
    dom.enemySprite.classList.toggle("enemy-attacking",action==="attack");
    if(action==="attack")setTimeout(()=>{if(runtime.enemy&&!runtime.enemy.boss){dom.enemySprite.style.backgroundPosition=`0% ${(runtime.enemy.enemyType*2)/5*100}%`;dom.enemySprite.classList.remove("enemy-attacking");}},460/state.speed);
  }
  function setAtlasPosition(el,url,index,cols,rows){const col=index%cols,row=Math.floor(index/cols);el.style.backgroundImage=`url('${url}')`;el.style.backgroundSize=`${cols*100}% ${rows*100}%`;el.style.backgroundPosition=`${cols===1?0:col/(cols-1)*100}% ${rows===1?0:row/(rows-1)*100}%`;}
  function gearIconStyle(slot,rarityIndex=0){const col={weapon:0,armor:1,relic:2}[slot]??0,row=clamp(rarityIndex,0,4);return`background-image:url('assets/ui/equipment.png');background-size:300% 500%;background-position:${col/2*100}% ${row/4*100}%`;}
  function setHeroAction(i,action){const el=$(`[data-hero="${i}"].battle-hero`);if(!el)return;el.style.backgroundPositionY=`${ACTION_ROWS[action]/6*100}%`;el.classList.remove("action-attack","action-skill","action-hit","down");if(action==="attack")el.classList.add("action-attack");if(action==="skill"||action==="ultimate")el.classList.add("action-skill");if(action==="hit")el.classList.add("action-hit");if(action==="down")el.classList.add("down");if(action!=="down")setTimeout(()=>{if(runtime.heroes[i].alive){el.style.backgroundPositionY="0%";el.classList.remove("action-attack","action-skill","action-hit")}},550/state.speed);}
  function emitSkillFx(heroIndex,type){
    if(state.settings.particles===false)return;
    const el=document.createElement("div");
    el.className=`skill-fx fx-hero-${heroIndex} ${type}`;
    el.innerHTML=Array.from({length:type==="ultimate"?8:5},()=>"<i></i>").join("");
    dom.fx.appendChild(el);setTimeout(()=>el.remove(),type==="ultimate"?950:650);
  }
  function emitHitFx(heroIndex,crit){
    if(state.settings.particles===false)return;
    const el=document.createElement("i");el.className=`hit-spark hit-hero-${heroIndex} ${crit?"crit":""}`;
    dom.fx.appendChild(el);setTimeout(()=>el.remove(),420);
  }
  function lootBurst(rarityIndex,slot){
    if(state.settings.particles===false)return;
    const el=document.createElement("div");el.className=`loot-burst loot-rarity-${rarityIndex}`;
    el.innerHTML=`<b style="${gearIconStyle(slot,rarityIndex)}"></b>${Array.from({length:7},()=>"<i></i>").join("")}`;
    dom.fx.appendChild(el);setTimeout(()=>el.remove(),1100);
  }
  function showBossIntro(stage){dom.bossTitle.textContent=bossName(stage);dom.bossIntro.classList.remove("hidden");setTimeout(()=>dom.bossIntro.classList.add("hidden"),2800/state.speed);}
  function discoverEnemy(){const e=runtime.enemy;if(e.boss)return;const id=`${e.zoneIndex}-${e.enemyType}`;if(!state.codex.enemies.includes(id))state.codex.enemies.push(id);}
  function bossName(stage){const zone=ZONES[zoneOf(stage)],evo=bossEvolution(stage);return `${zone.boss} · ${EVOLUTIONS[evo]}`;}
  function zoneOf(stage){return clamp(Math.floor((stage-1)/1000),0,9);}
  function bossEvolution(stage){return clamp(Math.ceil(((stage-1)%1000+1)/100)-1,0,9);}

  function floatNumber(text,x,y,crit=false,heal=false){const el=document.createElement("span");el.className=`float-number ${crit?"crit":""} ${heal?"heal":""}`;el.textContent=text;el.style.left=`${x}%`;el.style.top=`${y}%`;dom.damage.appendChild(el);setTimeout(()=>el.remove(),950);}
  function toastMini(text,x,y){floatNumber(text,x,y,false,true);}
  function toast(message,bad=false){const el=document.createElement("div");el.className=`toast ${bad?"bad":""}`;el.textContent=message;$("#toastStack").appendChild(el);setTimeout(()=>el.remove(),3200);}
  function showOfflineReport(r){openModal(`<h2 id="modalTitle">挂机收益</h2><p>网页关闭期间关卡保持在原位，金币与经验按离开时的效率累计。</p><div class="tab-grid"><div class="info-card"><h3>离开时间</h3><strong>${formatDuration(r.seconds)}</strong></div><div class="info-card"><h3>获得金币</h3><strong>${format(r.gold)}</strong></div><div class="info-card"><h3>每人经验</h3><strong>${format(r.xp)}</strong></div></div>`);}
  function rebirthModal(){openModal(`<h2 id="modalTitle">点燃重整篝火？</h2><p>关卡、金币、角色等级、技能等级与培养将被重置。装备、图鉴、天赋及最高纪录保留。</p><p>本次获得 <strong>${rebirthReward()} 灵魂余烬</strong></p><button class="primary-btn" data-action="rebirth-confirm">确认重整</button>`);}
  function exportSave(){saveState();const data=btoa(unescape(encodeURIComponent(JSON.stringify(state))));openModal(`<h2 id="modalTitle">导出存档</h2><p>复制下方文本并妥善保存。</p><textarea id="saveText">${data}</textarea><button class="inline-btn" data-action="copy-save">手动复制文本</button>`);const ta=$("#saveText");ta.focus();ta.select();navigator.clipboard?.writeText(data).then(()=>toast("存档已复制到剪贴板")).catch(()=>{});}
  function importSaveModal(){openModal(`<h2 id="modalTitle">导入存档</h2><p>粘贴存档文本。当前进度将在验证成功后被替换。</p><textarea id="saveText" placeholder="在此粘贴存档"></textarea><button class="primary-btn" data-action="import-confirm">验证并导入</button>`);}
  function importSave(){try{const text=$("#saveText").value.trim();const parsed=JSON.parse(decodeURIComponent(escape(atob(text))));state=mergeState(parsed);saveState();location.reload();}catch(e){toast("存档文本无效",true);}}
  function clearSaveModal(){openModal(`<h2 id="modalTitle">清空全部进度？</h2><p>此操作无法恢复。建议先导出存档。</p><button class="inline-btn danger-btn" data-action="clear-confirm">确认永久清空</button>`);}
  function openModal(html){dom.modalBody.innerHTML=html;dom.modal.classList.remove("hidden");runtime.paused=true;}
  function closeModal(){dom.modal.classList.add("hidden");runtime.paused=false;}
  function format(value){if(!Number.isFinite(value))return"∞";const abs=Math.abs(value);const units=[[1e24,"秭"],[1e20,"垓"],[1e16,"京"],[1e12,"兆"],[1e8,"亿"],[1e4,"万"]];for(const[u,n]of units)if(abs>=u)return`${(value/u).toFixed(abs>=u*100?0:abs>=u*10?1:2)}${n}`;return Math.floor(value).toLocaleString("zh-CN");}
  function formatDuration(sec){sec=Math.floor(sec);const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return`${h?`${h}小时`:""}${m?`${m}分钟`:""}${!h&&s?`${s}秒`:""}`||"0秒";}
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

  if (globalThis.__ABYSS_TEST_MODE__) {
    window.__ABYSS_TEST__ = {
      snapshot: () => JSON.parse(JSON.stringify({ state, runtime: { battleStage: runtime.battleStage, timer: runtime.timer, retryAt: runtime.retryAt, retryRemaining: runtime.retryRemaining, enemy: runtime.enemy } })),
      setStage: stage => { state.completed = false; state.stage = clamp(stage, 1, MAX_STAGE); resetPartyRuntime(); spawnStage(state.stage, true); },
      winNow: () => { if (runtime.enemy) { runtime.enemy.hp = 0; winStage(true); } },
      failNow: () => failStage(true),
      retryNow: () => { runtime.retryAt = 0; runtime.retryRemaining = 0; maybeAutoChallenge(); },
      backgroundSeconds: seconds => simulateBackground(seconds * state.speed),
      setBestStage: stage => { state.bestStage = clamp(stage, 1, MAX_STAGE); },
      rebirthNow: () => performRebirth()
    };
  }
  init();
})();
