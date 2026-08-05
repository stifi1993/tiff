(() => {
  "use strict";

  const SAVE_KEY = "abyss-expedition-v3";
  const SAVE_VERSION = 3;
  const LEGACY_SAVE_KEYS = ["abyss-expedition-v1", "abyss-expedition-backup-v1"];
  const RULES = globalThis.AbyssRules;
  if (!RULES) throw new Error("核心规则未加载");
  const {
    MAX_STAGE, OFFLINE_CAP, ENEMY_HP_GROWTH, ENEMY_ATK_GROWTH, ZONES, EVOLUTIONS,
    BOSS_MECHANICS, HERO_DEFS, BONFIRE_NODE_TYPES, BONFIRE_NODE_NAMES,
    zoneOf, bossEvolution, xpNeeded, skillEvolutionTier, enemyStats
  } = RULES;
  const SAVE_TEXT_LIMIT = 1024 * 1024;
  const DETAILED_BACKGROUND_WINDOW = 90;
  const KILL_TRANSITION_SECONDS = .48;
  const assetCache = new Map();
  const spriteTimers = new WeakMap();
  let preloadedZone = -1;
  let visualRandomState = (Date.now() ^ 0x9e3779b9) >>> 0;

  const RARITIES = [
    { name: "普通", color: "#a8b0bd", mult: 1, weight: 60 },
    { name: "稀有", color: "#5caeff", mult: 1.8, weight: 26 },
    { name: "史诗", color: "#b77aff", mult: 3.2, weight: 10 },
    { name: "传说", color: "#ffbd4a", mult: 5.7, weight: 3.3 },
    { name: "神话", color: "#ff6372", mult: 10, weight: .7 }
  ];
  const SLOT_NAMES = { weapon: "武器", armor: "护甲", relic: "饰品" };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const dom = {};
  const { initialState, mergeState } = globalThis.AbyssSaveState;
  const safeStorageRemove = key => globalThis.AbyssSaveState.safeStorageRemove(localStorage, key);
  let state = loadState();
  let runtime = createRuntime();
  let activeTab = "team";
  let drawerOpen = false;
  let drawerReturnFocus = null;
  let modalReturnFocus = null;
  let lastFrame = performance.now();
  let lastRender = 0;
  let lastSave = performance.now();
  // v3 是全新数值版本：按产品约定直接移除旧版存档，不执行迁移或备份。
  LEGACY_SAVE_KEYS.forEach(key => safeStorageRemove(key));

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
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
      enemy: null, timer: 12, enemyAttack: 1.2, bossAttackCount: 0, retryAt: 0, retryRemaining: 0, transitionRemaining: 0,
      battleStage: state.stage, stats: [], paused: false, pendingSpawn: false,
      backgroundMode: false, introSlow: false, introToken: 0,
      autoFeedExpanded: false, autoFeedSignature: "",
      autoSummary: { elapsed: 0, training: 0, skills: 0, enhances: 0 },
      heroes: HERO_DEFS.map(() => ({ hp: 1, maxHp: 1, energy: 0, attackCd: .2 + Math.random() * .5, skillCd: 2.2, shield: 0, corrosion: 0, alive: true }))
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
      saveState: $("#saveState"), fx: $("#fxLayer"), damage: $("#damageLayer"),
      bossIntro: $("#bossIntro"), bossTitle: $("#bossTitle"), victory: $("#victoryOverlay"), modal: $("#modal"), modalBody: $("#modalBody"),
      sideDrawer: $("#sideDrawer"), drawerTitle: $("#drawerTitle"), drawerClose: $("#drawerClose"), drawerScrim: $("#drawerScrim"),
      bossWinChance: $("#bossWinChance"), guideTip: $("#guideTip")
    });
    dom.autoFeed = $("#autoFeed"); dom.autoFeedList = $("#autoFeedList");
    applyDisplaySettings();
    if (state.pendingOffline) processAutomaticGrowth(5000);
    if (!state.autoLog.length) recordAuto("三人远征已经启程", true);
    buildSprites();
    bindEvents();
    spawnStage(state.stage, true);
    renderTab();
    render(true);
    if (state.completed) dom.victory.classList.remove("hidden");
    if (state.pendingOffline) {
      const report = state.pendingOffline;
      delete state.pendingOffline;
      setTimeout(() => showOfflineReport(report), 350);
    }
    if (!state.guide.dismissed) setTimeout(showGuide, 900);
    setInterval(loop, 100);
    window.addEventListener("beforeunload", () => saveState(false));
    if (document.documentElement && typeof performance !== "undefined") {
      document.documentElement.dataset.interactiveMs = String(Math.round(performance.now()));
    }
    // 不重置 lastFrame：后台标签页恢复时必须按真实经过时间补算战斗。
  }

  function buildSprites() {
    dom.partySprites.innerHTML = HERO_DEFS.map((hero, i) => `<img class="battle-hero hero-${i}" data-hero="${i}" src="assets-v3/heroes/${hero.id}/idle-1.webp" alt="${hero.name} · ${hero.role}" draggable="false" style="--hero-color:${hero.color}">`).join("");
    HERO_DEFS.forEach((hero, index) => {
      for (const action of ["idle", "move", "attack", "skill", "ultimate", "hit", "down"]) {
        heroFrameUrls(hero.id, action).forEach(url => preloadImage(url, action === "idle" ? "high" : "low"));
      }
      setHeroAction(index, "idle");
    });
  }

  function heroFrameUrls(heroId, action) {
    return Array.from({ length: 4 }, (_, index) => `assets-v3/heroes/${heroId}/${action}-${index + 1}.webp`);
  }

  function enemyFrameUrls(zoneIndex, enemyType, action) {
    const zone = String(zoneIndex + 1).padStart(2, "0");
    const enemy = String(enemyType + 1).padStart(2, "0");
    return Array.from({ length: 4 }, (_, index) => `assets-v3/enemies/zone-${zone}/enemy-${enemy}-${action}-${index + 1}.webp`);
  }

  function bossFrameUrl(zoneIndex, evolution) {
    return `assets-v3/bosses/family-${String(zoneIndex + 1).padStart(2, "0")}/form-${String(evolution + 1).padStart(2, "0")}.webp`;
  }

  function stopSpriteAnimation(element) {
    const running = spriteTimers.get(element);
    if (!running) return;
    if (running.interval) clearInterval(running.interval);
    if (running.timeout) clearTimeout(running.timeout);
    spriteTimers.delete(element);
  }

  function playSprite(element, frames, duration, loop = false, onDone) {
    stopSpriteAnimation(element);
    let index = 0;
    element.src = frames[0];
    if (state.settings.reduceMotion) {
      if (!loop && onDone) {
        const timeout = setTimeout(onDone, duration);
        spriteTimers.set(element, { timeout });
      }
      return;
    }
    const interval = setInterval(() => {
      index += 1;
      if (index >= frames.length) {
        if (loop) index = 0;
        else {
          clearInterval(interval);
          spriteTimers.delete(element);
          if (onDone) onDone();
          return;
        }
      }
      element.src = frames[index];
    }, Math.max(55, duration / frames.length));
    spriteTimers.set(element, { interval });
  }

  function preloadImage(url, priority = "low") {
    if (assetCache.has(url) || typeof Image === "undefined") return assetCache.get(url);
    const image = new Image();
    image.decoding = "async";
    if ("fetchPriority" in image) image.fetchPriority = priority;
    image.src = url;
    assetCache.set(url, image);
    return image;
  }

  function zoneAssets(zoneIndex) {
    const number = String(zoneIndex + 1).padStart(2, "0");
    return [
      `assets-webp/backgrounds/zone-${number}.webp`,
      ...Array.from({ length: 3 }, (_, enemy) => ["idle", "attack"].flatMap(action => enemyFrameUrls(zoneIndex, enemy, action))).flat(),
      ...Array.from({ length: 10 }, (_, evolution) => bossFrameUrl(zoneIndex, evolution))
    ];
  }

  function scheduleZonePreload(zoneIndex) {
    if (preloadedZone === zoneIndex) return;
    preloadedZone = zoneIndex;
    zoneAssets(zoneIndex).forEach(url => preloadImage(url, "high"));
    if (document.documentElement) document.documentElement.dataset.preloadedZone = String(zoneIndex + 1);
    const nextZone = Math.min(ZONES.length - 1, zoneIndex + 1);
    if (nextZone === zoneIndex) return;
    const preloadNext = () => zoneAssets(nextZone).forEach(url => preloadImage(url));
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(preloadNext, { timeout: 1800 });
    else setTimeout(preloadNext, 700);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const speed = event.target.closest("[data-speed]");
      if (speed && !speed.classList.contains("locked")) { state.speed = Number(speed.dataset.speed); state.settings.autoMaxSpeed = false; render(); return; }
      const tab = event.target.closest("[data-tab]");
      if (tab) { openDrawer(tab.dataset.tab); return; }
      const action = event.target.closest("[data-action]");
      if (action) handleAction(action.dataset.action, action.dataset); 
    });
    $("#upgradeAllBtn").addEventListener("click", () => {
      const bought = processAutomaticGrowth(500);
      flushAutoSummary(true);
      toast(bought ? `自动完成${bought}次成长` : "当前资源不足");
      render(true);
    });
    $("#autoTrainBtn").addEventListener("click", toggleAutoTrain);
    dom.challengeBtn.addEventListener("click", immediateChallenge);
    dom.drawerClose.addEventListener("click", closeDrawer);
    dom.drawerScrim.addEventListener("click", closeDrawer);
    $("#modalClose").addEventListener("click", closeModal);
    dom.modal.addEventListener("click", e => { if (e.target === dom.modal) closeModal(); });
    window.addEventListener("keydown", e => {
      if (e.key === "Escape") { if (!dom.modal.classList.contains("hidden")) closeModal(); else closeDrawer(); }
      if (e.key === "Tab" && !dom.modal.classList.contains("hidden")) trapFocus(e, dom.modal);
      else if (e.key === "Tab" && drawerOpen) trapFocus(e, dom.sideDrawer);
      if ((e.key === "Enter" || e.key === " ") && e.target?.classList?.contains("hero-card")) { e.preventDefault(); openDrawer("team"); }
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function openDrawer(tab = "team") {
    const titles = { team: "队伍成长", codex: "深渊图鉴", rebirth: "篝火星图", settings: "远征设置" };
    if (!drawerOpen) drawerReturnFocus = document.activeElement;
    activeTab = tab;
    drawerOpen = true;
    dom.drawerTitle.textContent = titles[tab] || "远征整备";
    dom.sideDrawer.classList.add("open");
    dom.sideDrawer.setAttribute("aria-hidden", "false");
    dom.drawerScrim.classList.add("open");
    $$(".tab-btn").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
    renderTab();
    setTimeout(() => focusFirst(dom.sideDrawer), 0);
  }

  function closeDrawer() {
    drawerOpen = false;
    dom.sideDrawer.classList.remove("open");
    dom.sideDrawer.setAttribute("aria-hidden", "true");
    dom.drawerScrim.classList.remove("open");
    $$(".tab-btn").forEach(button => button.classList.remove("active"));
    if (drawerReturnFocus?.focus) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }

  function focusableElements(container) {
    if (!container?.querySelectorAll) return [];
    return [...container.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.getAttribute?.("aria-hidden") !== "true");
  }

  function focusFirst(container) { focusableElements(container)[0]?.focus(); }

  function trapFocus(event, container) {
    const elements = focusableElements(container);
    if (!elements.length) return;
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      saveState(false);
      stopSpriteAnimation(dom.enemySprite);
      $$(".battle-hero").forEach(stopSpriteAnimation);
      return;
    }
    loop(performance.now());
    updateEnemySprite();
    runtime.heroes.forEach((hero, index) => { if (hero.alive) setHeroAction(index, "idle"); });
    render(true);
  }

  function loop(now = performance.now()) {
    const elapsed = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!runtime.paused && !state.completed) {
      const speed = currentSpeed();
      if (elapsed > 2) simulateBackground(elapsed * speed);
      else { maybeAutoChallenge(elapsed); simulateForeground(Math.min(elapsed, .5) * speed); }
    }
    if (!document.hidden && now - lastRender > 180) { render(); lastRender = now; }
    if (now - lastSave > 5000) { saveState(false); lastSave = now; }
  }

  function spawnStage(stage, fresh = false) {
    runtime.battleStage = clamp(stage, 1, MAX_STAGE);
    const baseEnemy = enemyStats(runtime.battleStage);
    const { zoneIndex, boss, elite, evo, enemyType } = baseEnemy;
    scheduleZonePreload(zoneIndex);
    const hp = baseEnemy.hp, atk = baseEnemy.atk;
    runtime.enemy = {
      maxHp: hp, hp, atk, boss, elite, zoneIndex, evo, enemyType, debuff: 0,
      shell: boss && zoneIndex === 1 ? 5 + Math.ceil((evo + 1) / 2) : 0,
      abyssShield: boss && zoneIndex === 9 ? hp * (.04 + evo * .004) : 0
    };
    runtime.timer = boss ? 30 : 12;
    runtime.enemyAttack = boss ? 1.05 : 1.35;
    runtime.bossAttackCount = 0;
    runtime.pendingSpawn = false;
    if (fresh || runtime.heroes.every(h => !h.alive)) resetPartyRuntime();
    if (!runtime.backgroundMode) updateEnemySprite();
    discoverEnemy();
    if (boss && !state.firstBossSeen.includes(stage)) {
      state.firstBossSeen.push(stage);
      if (!runtime.backgroundMode) showBossIntro(stage);
    }
    if (!state.firstZoneSeen.includes(zoneIndex)) {
      state.firstZoneSeen.push(zoneIndex);
      toast(`进入新区域：${ZONES[zoneIndex].name}`);
    }
  }

  function resetPartyRuntime() {
    runtime.heroes.forEach((hero, i) => {
      const stats = heroStats(i);
      hero.maxHp = stats.hp; hero.hp = stats.hp; hero.energy = 0; hero.attackCd = .2 + i * .2; hero.skillCd = 2 + i; hero.shield = 0; hero.corrosion = 0; hero.alive = true;
    });
  }

  function refreshPartyStats() {
    runtime.heroes.forEach((hero, i) => {
      const previousMax = Math.max(1, hero.maxHp);
      const healthRatio = hero.alive ? clamp(hero.hp / previousMax, 0, 1) : 0;
      const stats = heroStats(i);
      hero.maxHp = stats.hp;
      hero.hp = hero.alive ? Math.max(1, stats.hp * healthRatio) : 0;
    });
  }

  function simulateDetailed(dt) {
    if (runtime.pendingSpawn) { advanceTransition(dt); return; }
    if (!runtime.enemy) return;
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
    if (runtime.timer <= 0 || runtime.heroes.every(h => !h.alive)) failStage(runtime.backgroundMode);
    processAutoTrain(dt);
    trimStats();
  }

  function nextCombatEvent(remaining) {
    if (runtime.pendingSpawn) return Math.max(.001, Math.min(remaining, runtime.transitionRemaining || KILL_TRANSITION_SECONDS));
    const heroEvents = runtime.heroes.flatMap((hero, i) => {
      if (!hero.alive) return [];
      const events = [hero.attackCd];
      if (state.heroes[i].skillLevels[1] > 0) events.push(hero.skillCd);
      if (hero.energy >= 100 && state.heroes[i].skillLevels[3] > 0) events.push(.001);
      return events;
    });
    return Math.max(.001, Math.min(remaining, runtime.timer, runtime.enemyAttack, ...heroEvents.filter(Number.isFinite)));
  }

  function simulateForeground(seconds) {
    let remaining = seconds;
    let safety = 0;
    runtime.backgroundMode = false;
    while (remaining > 0 && safety++ < 1000 && !state.completed && runtime.enemy) {
      const nextEvent = nextCombatEvent(remaining);
      simulateDetailed(nextEvent);
      remaining -= nextEvent;
    }
  }

  function simulateBackground(seconds) {
    let remaining = Math.max(0, seconds);
    const detailed = Math.min(remaining, DETAILED_BACKGROUND_WINDOW);
    simulateBackgroundDetailed(detailed);
    remaining -= detailed;
    if (remaining > 0 && !state.completed) simulateBackgroundFast(remaining);
  }

  function simulateBackgroundDetailed(seconds) {
    let remaining = Math.max(0, seconds);
    let safety = 0;
    runtime.backgroundMode = true;
    while (remaining > 0 && safety++ < 200000 && !state.completed) {
      if (state.activeBossStage && runtime.retryRemaining <= 0) { immediateChallenge(); continue; }
      if (!runtime.enemy) spawnStage(state.stage, true);
      const retryCombat = state.activeBossStage ? runtime.retryRemaining * state.speed : Infinity;
      const nextEvent = Math.min(nextCombatEvent(remaining), retryCombat);
      simulateDetailed(nextEvent);
      remaining -= nextEvent;
      if (state.activeBossStage) {
        runtime.retryRemaining = Math.max(0, runtime.retryRemaining - nextEvent / state.speed);
        runtime.retryAt = Date.now() + runtime.retryRemaining * 1000;
        if (runtime.retryRemaining <= 0) immediateChallenge();
      }
    }
    runtime.backgroundMode = false;
  }

  function estimateFastBattle() {
    const enemy = runtime.enemy;
    if (!enemy) return { won: false, seconds: .1 };
    const family = enemy.boss ? enemy.zoneIndex : -1;
    let dps = Math.max(1, estimatedDps() * (enemy.debuff > 0 ? 1.16 : 1));
    if (family === 1 && enemy.shell > 0) dps *= .88;
    if (family === 2) dps = Math.max(1, dps - enemy.maxHp * (.007 + enemy.evo * .0007) / (enemyAttackInterval(enemy) * 4));
    const effectiveHp = enemy.hp + (enemy.abyssShield || 0);
    const killSeconds = effectiveHp / dps;
    const partyEhp = runtime.heroes.reduce((sum, hero, index) => hero.alive ? sum + hero.hp + hero.shield + heroStats(index).def * 7 : sum, 0);
    const healing = runtime.heroes[2].alive && state.heroes[2].skillLevels[1] > 0 ? heroStats(2).heal * .32 : 0;
    const attackInterval = enemyAttackInterval(enemy);
    let danger = enemy.boss ? .94 : .72;
    if (family === 0) danger *= 1.18;
    if (family === 3 && enemy.hp / enemy.maxHp < .4) danger *= 1.45;
    if (family === 4) danger *= 1.16;
    if (family === 5) danger *= 1.2;
    if (family === 8) danger *= 1.12;
    if (family === 9) danger *= 1.28;
    const incoming = Math.max(1, enemy.atk / attackInterval * danger - healing);
    const surviveSeconds = partyEhp / incoming;
    const limit = Math.max(.25, Math.min(runtime.timer, surviveSeconds));
    return { won: killSeconds <= limit, seconds: Math.max(.25, Math.min(killSeconds, limit)), dps };
  }

  function simulateBackgroundFast(seconds) {
    let remaining = Math.max(0, seconds);
    let safety = 0;
    runtime.backgroundMode = true;
    while (remaining > .0001 && safety++ < 50000 && !state.completed) {
      if (!runtime.enemy) spawnStage(state.stage, true);
      if (runtime.pendingSpawn) {
        const step = Math.min(remaining, runtime.transitionRemaining || KILL_TRANSITION_SECONDS);
        advanceTransition(step);
        remaining -= step;
        continue;
      }
      if (state.activeBossStage && runtime.retryRemaining <= 0 && runtime.battleStage !== state.activeBossStage) {
        immediateChallenge();
        continue;
      }
      const result = estimateFastBattle();
      const step = Math.min(remaining, result.seconds);
      runtime.timer = Math.max(0, runtime.timer - step);
      runtime.enemyAttack = Math.max(.001, runtime.enemyAttack - step);
      processAutoTrain(step);
      if (state.activeBossStage && runtime.battleStage !== state.activeBossStage) {
        runtime.retryRemaining = Math.max(0, runtime.retryRemaining - step / state.speed);
        runtime.retryAt = Date.now() + runtime.retryRemaining * 1000;
      }
      remaining -= step;
      if (step + .0001 < result.seconds) {
        const dealt = result.dps * step;
        if (runtime.enemy.abyssShield > 0) {
          const absorbed = Math.min(runtime.enemy.abyssShield, dealt);
          runtime.enemy.abyssShield -= absorbed;
          runtime.enemy.hp = Math.max(1, runtime.enemy.hp - Math.max(0, dealt - absorbed));
        } else runtime.enemy.hp = Math.max(1, runtime.enemy.hp - dealt);
        continue;
      }
      if (result.won) {
        runtime.enemy.hp = 0;
        winStage(true);
      } else {
        runtime.enemy.hp = Math.max(1, runtime.enemy.hp * .12);
        failStage(true);
      }
    }
    flushAutoSummary(true);
    runtime.backgroundMode = false;
  }

  function advanceTransition(dt) {
    if (!runtime.pendingSpawn) return;
    runtime.transitionRemaining = Math.max(0, runtime.transitionRemaining - dt);
    if (runtime.transitionRemaining <= 0) advanceAfterWin();
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
    if (!runtime.backgroundMode) setHeroAction(i, "attack");
  }

  function castSkill(i) {
    const hero = runtime.heroes[i];
    const level = Math.max(1, state.heroes[i].skillLevels[1]);
    hero.skillCd = i === 0 ? 8 : i === 1 ? 5 : 6;
    if (i === 0) {
      const tier = skillEvolutionTier(state.heroes[0].level);
      runtime.heroes.forEach(target => { if (target.alive) target.shield += heroStats(0).hp * (.12 + level * .012) * (1 + tier * .16); });
      toastMini("守护壁垒", 31, 37);
    } else if (i === 1) {
      const tier = skillEvolutionTier(state.heroes[1].level);
      const damage = heroStats(1).atk * (2.25 + level * .12) * (1 + tier * .22);
      dealDamage(damage, i, Math.random() < heroStats(1).crit);
      runtime.enemy.debuff = 5;
    } else {
      const tier = skillEvolutionTier(state.heroes[2].level);
      const power = heroStats(2).heal * (1.9 + level * .1) * (1 + tier * .2);
      const targetIndex = runtime.heroes.reduce((best, h, idx, arr) => h.alive && h.hp / h.maxHp < arr[best].hp / arr[best].maxHp ? idx : best, 0);
      healHero(targetIndex, power);
      runtime.heroes.forEach(h => { if (h.alive) h.energy = Math.min(100, h.energy + 8); });
    }
    if (!runtime.backgroundMode) { setHeroAction(i, "skill"); emitSkillFx(i, "skill"); }
  }

  function castUltimate(i) {
    const hero = runtime.heroes[i];
    hero.energy = 0;
    if (i === 0) {
      const tier = skillEvolutionTier(state.heroes[0].level);
      runtime.heroes.forEach(h => { if (h.alive) h.shield += heroStats(0).hp * .55 * (1 + tier * .18); });
      toast("王宇彤释放「不落城塞」");
    } else if (i === 1) {
      dealDamage(heroStats(1).atk * 7.5 * (1 + skillEvolutionTier(state.heroes[1].level) * .25), i, true);
      toast("王尚释放「百矢夜幕」");
    } else {
      const down = runtime.heroes.findIndex(h => !h.alive);
      if (down >= 0) {
        const stats = heroStats(down), tier = skillEvolutionTier(state.heroes[2].level); runtime.heroes[down].alive = true; runtime.heroes[down].maxHp = stats.hp; runtime.heroes[down].hp = stats.hp * (.45 + tier * .12); runtime.heroes[down].shield = stats.hp * (.2 + tier * .08);
        if (!runtime.backgroundMode) setHeroAction(down, "idle"); toast(`徐崇睿以「命运回响」复活了${HERO_DEFS[down].name}`);
      } else runtime.heroes.forEach((h, idx) => healHero(idx, heroStats(2).heal * 2.8));
    }
    if (!runtime.backgroundMode) { setHeroAction(i, "ultimate"); emitSkillFx(i, "ultimate"); }
  }

  function enemyAttack() {
    const e = runtime.enemy;
    if (!runtime.backgroundMode) setEnemyAction("attack");
    const interval = enemyAttackInterval(e);
    runtime.enemyAttack += interval;
    runtime.bossAttackCount++;
    const alive = runtime.heroes.map((h, i) => h.alive ? i : -1).filter(i => i >= 0);
    if (!alive.length) return;
    const family = e.boss ? e.zoneIndex : -1;
    const aoe = e.boss && ((family === 0 && runtime.bossAttackCount % 4 === 0) || (family === 9 && runtime.bossAttackCount % 3 === 0));
    let targets = aoe ? alive : [alive.includes(0) ? 0 : alive[Math.floor(Math.random() * alive.length)]];
    if (family === 4 && runtime.bossAttackCount % 3 === 0 && alive.length > 1) targets = alive.slice(0, 2);
    targets.forEach(i => {
      const target = runtime.heroes[i];
      const stats = heroStats(i);
      let damage = Math.max(1, e.atk * (.9 + Math.random() * .2) - stats.def * .65);
      if (family === 3 && e.hp / e.maxHp < .4) damage *= 1.45 + e.evo * .015;
      if (family === 5) damage *= 1 + target.corrosion * .07;
      if (family === 8 && target.hp / target.maxHp < .35) damage *= 1.7 + e.evo * .02;
      if (runtime.enemy.debuff > 0) damage *= .82;
      damage *= 1 / bonfireMultiplier("vitality");
      if (target.shield > 0) { const absorbed = Math.min(target.shield, damage); target.shield -= absorbed; damage -= absorbed; }
      target.hp = Math.max(0, target.hp - damage);
      if (!runtime.backgroundMode) { floatNumber(format(damage), 18 + i * 11, 55, false, false); setHeroAction(i, "hit"); }
      if (target.hp <= 0) { target.alive = false; if (!runtime.backgroundMode) setHeroAction(i, "down"); }
      if (family === 5 && target.alive) target.corrosion = Math.min(8, target.corrosion + 1);
    });
    if (family === 2 && runtime.bossAttackCount % 4 === 0) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * (.007 + e.evo * .0007));
    if (family === 6 && runtime.bossAttackCount % 4 === 0 && runtime.heroes[1].alive) runtime.heroes[1].attackCd += 1.1 + e.evo * .04;
    if (family === 7 && runtime.bossAttackCount % 3 === 0) runtime.heroes.forEach(hero => { if (hero.alive) hero.energy = Math.max(0, hero.energy - 18 - e.evo); });
    if (e.debuff > 0) e.debuff -= interval;
    if (!runtime.backgroundMode) dom.enemyUnit.classList.remove("hit");
  }

  function enemyAttackInterval(enemy) {
    if (!enemy?.boss) return 1.35;
    if (enemy.zoneIndex === 3 && enemy.hp / Math.max(1, enemy.maxHp) < .4) return Math.max(.58, .82 - enemy.evo * .012);
    return 1.05;
  }

  function dealDamage(amount, heroIndex, crit = false) {
    if (!runtime.enemy || runtime.enemy.hp <= 0) return;
    const enemy = runtime.enemy;
    if (enemy.boss && enemy.zoneIndex === 1 && enemy.shell > 0) { amount *= .66; enemy.shell--; }
    if (enemy.boss && enemy.zoneIndex === 9 && enemy.abyssShield > 0) {
      const absorbed = Math.min(enemy.abyssShield, Math.max(1, amount));
      enemy.abyssShield -= absorbed;
      amount -= absorbed;
      if (amount <= 0) return;
    }
    const damage = Math.min(enemy.hp, Math.max(1, amount));
    runtime.enemy.hp -= damage;
    runtime.stats.push({ at: Date.now(), type: "damage", value: damage });
    if (!runtime.backgroundMode && state.settings.showDamage) floatNumber(format(damage), 72 + visualRandom() * 10, 34 + visualRandom() * 16, crit, false);
    if (!runtime.backgroundMode) {
      emitHitFx(heroIndex, crit);
      dom.enemyUnit.classList.remove("hit"); void dom.enemyUnit.offsetWidth; dom.enemyUnit.classList.add("hit");
    }
    if (runtime.enemy.hp <= 0) winStage(runtime.backgroundMode);
  }

  function healHero(i, amount) {
    const hero = runtime.heroes[i];
    if (!hero.alive) return;
    const actual = Math.min(amount, hero.maxHp - hero.hp);
    hero.hp += actual;
    runtime.stats.push({ at: Date.now(), type: "heal", value: actual });
    if (!runtime.backgroundMode && actual > 0 && state.settings.showDamage) floatNumber(`+${format(actual)}`, 19 + i * 11, 48, false, true);
  }

  function winStage(background = false) {
    const defeated = runtime.enemy;
    if (!defeated) return;
    runtime.pendingSpawn = true;
    runtime.transitionRemaining = KILL_TRANSITION_SECONDS;
    state.totalKills++;
    const rewardMult = bonfireMultiplier("gold");
    const gold = (12 + runtime.battleStage * .85) * (defeated.boss ? 12 : defeated.elite ? 3 : 1) * rewardMult;
    const xp = (8 + runtime.battleStage * .48) * (defeated.boss ? 8 : defeated.elite ? 2 : 1) * rewardMult;
    state.gold += gold;
    state.heroes.forEach((h, i) => addXpRaw(h, xp * bonfireMultiplier("xp"), i));
    if (defeated.boss) {
      const first = !state.codex.bosses.includes(runtime.battleStage);
      if (first) { state.codex.bosses.push(runtime.battleStage); state.embers += 2 + Math.floor(runtime.battleStage / 500); generateGear(true); recordAuto(`首胜 ${bossName(runtime.battleStage)} · 第${runtime.battleStage}关`, true); toast(`首胜！获得灵魂余烬与保底装备`); }
      else if (Math.random() < .08) generateGear(false);
    } else if (Math.random() < (.075 * bonfireMultiplier("gear"))) generateGear(false);
    state.bonfire.bossFailures = 0;
    if (!background) {
      dom.enemyUnit.classList.add("dead");
    }
  }

  function advanceAfterWin() {
    runtime.pendingSpawn = false;
    runtime.transitionRemaining = 0;
    dom.enemyUnit?.classList.remove("dead");
    if (runtime.battleStage >= MAX_STAGE) {
      state.stage = MAX_STAGE; state.bestStage = MAX_STAGE; state.completed = true; dom.victory.classList.remove("hidden"); saveState(); return;
    }
    state.bestStage = Math.max(state.bestStage, runtime.battleStage);
    if (state.activeBossStage && runtime.battleStage === state.activeBossStage - 1) {
      state.stage = runtime.battleStage;
      spawnStage(state.stage, false);
      return;
    }
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
      state.bonfire.bossFailures++;
      state.activeBossStage = failedStage;
      runtime.retryAt = Date.now() + 30000;
      runtime.retryRemaining = 30;
      state.stage = Math.max(1, failedStage - 1);
      if (!background) toast(`${bossName(failedStage)}挑战失败，退回前一关整备`, true);
    } else {
      state.bonfire.bossFailures++;
      const progress = runtime.enemy ? clamp(1 - runtime.enemy.hp / Math.max(1, runtime.enemy.maxHp), .05, .9) : .05;
      const gold = (12 + failedStage * .85) * .18 * progress * bonfireMultiplier("gold");
      const xp = (8 + failedStage * .48) * .14 * progress;
      state.gold += gold;
      state.heroes.forEach((hero, i) => addXpRaw(hero, xp * bonfireMultiplier("xp"), i));
      state.stage = Math.max(1, failedStage);
    }
    resetPartyRuntime();
    runtime.pendingSpawn = false;
    spawnStage(state.stage, true);
    if (shouldAutoRebirth()) performRebirth(true);
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
    if (!state.autoTrain.enabled) return;
    state.autoTrainClock = (state.autoTrainClock || 0) + dt;
    runtime.autoSummary.elapsed += dt;
    if (runtime.autoSummary.elapsed >= 30) flushAutoSummary();
    if (state.autoTrainClock < .35) return;
    state.autoTrainClock = 0;
    processAutomaticGrowth(30);
  }

  function growthPressure() {
    const alive = runtime.heroes.filter(hero => hero.alive);
    const health = alive.length ? alive.reduce((sum, hero) => sum + hero.hp / Math.max(1, hero.maxHp), 0) / alive.length : 0;
    const enemyRatio = runtime.enemy ? runtime.enemy.hp / Math.max(1, runtime.enemy.maxHp) : 0;
    return {
      survival: health < .55 || runtime.heroes.some(hero => !hero.alive),
      damage: Boolean(state.activeBossStage) || (runtime.timer < 4 && enemyRatio > .2)
    };
  }

  function processAutomaticGrowth(limit = 50) {
    if (!state.autoTrain.enabled) return 0;
    let purchases = 0, trainingBought = 0, skillsBought = 0;
    const pressure = growthPressure();
    while (purchases < limit) {
      const candidates = [];
      state.heroes.forEach((hero, heroIndex) => {
        const roleWeight = pressure.survival ? [1.45, .78, 1.25][heroIndex] : pressure.damage ? [.82, 1.55, 1.05][heroIndex] : [1, 1.12, 1.02][heroIndex];
        const trainingPrice = trainCost(heroIndex);
        candidates.push({ type: "training", heroIndex, cost: trainingPrice, score: roleWeight * (.08 + hero.training * .0005) / Math.max(1, trainingPrice) });
        hero.skillLevels.forEach((level, skillIndex) => {
          if (skillIndex === 0 || level <= 0) return;
          const cost = skillCost(heroIndex, skillIndex);
          const skillWeight = (heroIndex === 1 ? 1.35 : heroIndex === 2 && pressure.survival ? 1.4 : 1) * (skillIndex === 3 ? 1.25 : 1);
          candidates.push({ type: "skill", heroIndex, skillIndex, cost, score: skillWeight * .06 / Math.max(1, cost) });
        });
      });
      const affordable = candidates.filter(candidate => candidate.cost <= state.gold).sort((a, b) => b.score - a.score)[0];
      if (!affordable) break;
      state.gold -= affordable.cost;
      if (affordable.type === "training") {
        state.heroes[affordable.heroIndex].training++;
        state.autoTotals.training++;
        trainingBought++;
      } else {
        state.heroes[affordable.heroIndex].skillLevels[affordable.skillIndex]++;
        state.autoTotals.skills++;
        skillsBought++;
      }
      purchases++;
    }
    const enhanced = autoEnhanceGear(30);
    runtime.autoSummary.training += trainingBought;
    runtime.autoSummary.skills += skillsBought;
    runtime.autoSummary.enhances += enhanced;
    if (purchases || enhanced) refreshPartyStats();
    if (state.pendingOffline) state.pendingOffline.upgrades = (state.pendingOffline.upgrades || 0) + purchases;
    return purchases;
  }

  function heroStats(i) {
    const def = HERO_DEFS[i], hero = state.heroes[i];
    const effectiveLevel = Math.min(hero.level, 100);
    const levelMult = 1 + (effectiveLevel - 1) * .075;
    const trainMult = 1 + hero.training * .09;
    let atk = def.baseAtk * levelMult * trainMult;
    let hp = def.baseHp * levelMult * trainMult;
    let defense = def.baseDef * (1 + (effectiveLevel - 1) * .055) * (1 + hero.training * .065);
    let crit = i === 1 ? .14 : .05, critDmg = i === 1 ? 1.85 : 1.55, heal = i === 2 ? atk * 2.3 : atk;
    const evolution = skillEvolutionTier(hero.level);
    if (i === 0) { hp *= 1 + evolution * .14; defense *= 1 + evolution * .12; }
    if (i === 1) { atk *= 1 + evolution * .13; crit += evolution * .035; }
    if (i === 2) heal *= 1 + evolution * .16;
    Object.values(hero.gear).filter(Boolean).forEach(g => {
      const value = gearValue(g);
      if (g.slot === "weapon") atk += value;
      if (g.slot === "armor") { hp += value * 8; defense += value * .45; }
      if (g.slot === "relic") { crit += value * .00065; heal += value * .75; }
    });
    hp *= bonfireMultiplier("vitality") * bonfireMultiplier("all");
    defense *= bonfireMultiplier("vitality") * bonfireMultiplier("all");
    atk *= bonfireMultiplier("attack") * bonfireMultiplier("all");
    heal *= bonfireMultiplier("vitality") * bonfireMultiplier("all");
    return { hp, atk, def: defense, crit: Math.min(.65, crit), critDmg, heal, haste: Math.min(.6, effectiveLevel * .0007), bossDamage: bonfireMultiplier("attack") };
  }

  function teamPower() { return HERO_DEFS.reduce((sum, _, i) => { const s = heroStats(i); return sum + s.atk * 8 + s.hp * .8 + s.def * 10; }, 0); }
  function estimatedDps() { return HERO_DEFS.reduce((sum, def, i) => { const s = heroStats(i); return sum + s.atk / def.interval * (1 + s.crit * (s.critDmg - 1)) * (i === 1 ? 1.28 : 1.12); }, 0) * (runtime.enemy?.boss ? bonfireMultiplier("attack") : 1); }
  function offlineRates(s = state) { const floor = Math.max(1, Math.min(s.stage, s.bestStage)); const level = s.bonfire?.level || 0; const goldNodes = countBonfireType("gold", level) + countBonfireType("all", level) * .375; const xpNodes = countBonfireType("xp", level) + countBonfireType("all", level) * .375; return { gold: (.7 + floor * .025) * (1 + goldNodes * .04), xp: (.42 + floor * .014) * (1 + xpNodes * .04) }; }

  function addXpRaw(hero, amount, heroIndex = -1) {
    const previousLevel = hero.level;
    hero.xp += amount;
    let needed = xpNeeded(hero.level);
    while (hero.xp >= needed) { hero.xp -= needed; hero.level++; unlockSkills(hero); needed = xpNeeded(hero.level); }
    if (heroIndex >= 0) for (const milestone of [100, 200]) if (previousLevel < milestone && hero.level >= milestone) {
      const title = milestone === 100 ? "精研" : "觉醒";
      recordAuto(`${HERO_DEFS[heroIndex].name}达到${milestone}级，技能${title}`, true);
      toast(`${HERO_DEFS[heroIndex].name}技能${title}！`);
    }
  }
  function unlockSkills(hero) {
    if (hero.level >= 10 && hero.skillLevels[1] === 0) hero.skillLevels[1] = 1;
    if (hero.level >= 25 && hero.skillLevels[2] === 0) hero.skillLevels[2] = 1;
    if (hero.level >= 50 && hero.skillLevels[3] === 0) hero.skillLevels[3] = 1;
  }
  function skillEvolutionName(level) { return ["初式", "精研", "觉醒"][skillEvolutionTier(level)]; }
  function trainCost(i) { const h = state.heroes[i]; return Math.floor(25 * Math.pow(1.18, h.training) * (1 + i * .04)); }
  function skillCost(i, skill) { const level = state.heroes[i].skillLevels[skill]; return Math.floor(70 * Math.pow(1.42, level) * (1 + skill * .7)); }
  function buyTraining(i, notify = true) { const cost = trainCost(i); if (state.gold < cost) { if (notify) toast("金币不足", true); return false; } state.gold -= cost; state.heroes[i].training++; state.autoTotals.training++; refreshPartyStats(); renderTab(); return true; }
  function upgradeAll() { const bought = processAutomaticGrowth(500); if (!bought) toast("金币不足", true); else toast(`自动完成${bought}次成长`); }
  function toggleAutoTrain() { state.autoTrain.enabled = !state.autoTrain.enabled; toast(state.autoTrain.enabled ? "自动成长已开启" : "自动成长已暂停"); render(); }

  function generateGear(guaranteed = false) {
    const stage = runtime.battleStage;
    let slot, heroIndex;
    if (guaranteed) {
      const weakest = state.heroes.flatMap((hero, index) => Object.entries(hero.gear).map(([gearSlot, item]) => ({ heroIndex: index, slot: gearSlot, value: item ? gearValue(item) : 0 }))).sort((a, b) => a.value - b.value)[0];
      slot = weakest.slot; heroIndex = weakest.heroIndex;
    } else {
      slot = ["weapon","armor","relic"][Math.floor(Math.random()*3)];
      heroIndex = Math.floor(Math.random() * HERO_DEFS.length);
    }
    const floorRarity = guaranteed ? Math.min(4, Math.floor((stage - 1) / 2000)) : 0;
    const roll = Math.random() * 100;
    let acc = 0, rarityIndex = 0;
    for (let i=0;i<RARITIES.length;i++){acc+=RARITIES[i].weight;if(roll<=acc){rarityIndex=i;break;}}
    rarityIndex = Math.max(floorRarity, rarityIndex);
    const rarity = RARITIES[rarityIndex];
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, heroIndex, slot, rarity: rarity.name, rarityIndex, base: Math.round((5 + stage * .18) * rarity.mult * (.86 + Math.random() * .28)), enhance: 0, stage };
    if (!state.codex.gear.includes(rarity.name)) state.codex.gear.push(rarity.name);
    if (!runtime.backgroundMode) lootBurst(rarityIndex,slot);
    const current = state.heroes[heroIndex].gear[slot];
    if (!current || gearValue(item) > gearValue(current)) {
      if (current) state.dust += salvageValue(current);
      state.heroes[heroIndex].gear[slot] = item;
      state.autoTotals.equips++;
      recordAuto(`${HERO_DEFS[heroIndex].name}自动换上${rarity.name}${SLOT_NAMES[slot]}`, rarityIndex >= 3);
      if (!runtime.backgroundMode && rarityIndex >= 3) toast(`${HERO_DEFS[heroIndex].name}换上${rarity.name}${SLOT_NAMES[slot]}`);
    } else {
      state.dust += salvageValue(item);
    }
    const enhanced = autoEnhanceGear(12);
    runtime.autoSummary.enhances += enhanced;
    refreshPartyStats();
  }
  function gearValue(g) { return g.base * (1 + g.enhance * .12); }
  function salvageValue(g) { return Math.floor(g.base * .38 + g.enhance * g.base * .08); }
  function enhanceCost(g) { return Math.floor((12 + g.base * .22) * Math.pow(1.22, g.enhance)); }

  function autoEnhanceGear(limit = 30) {
    let enhanced = 0;
    while (enhanced < limit) {
      const candidates = [];
      state.heroes.forEach((hero, heroIndex) => Object.entries(hero.gear).forEach(([slot, item]) => {
        if (!item || item.enhance >= 20) return;
        const cost = enhanceCost(item);
        const gain = item.base * .12;
        if (cost <= state.dust) candidates.push({ heroIndex, slot, item, cost, score: gain / Math.max(1, cost) });
      }));
      const best = candidates.sort((a, b) => b.score - a.score)[0];
      if (!best) break;
      state.dust -= best.cost;
      best.item.enhance++;
      state.autoTotals.enhances++;
      enhanced++;
    }
    return enhanced;
  }

  function recordAuto(message, important = false) {
    state.autoLog.unshift({ at: Date.now(), message, important });
    state.autoLog = state.autoLog.slice(0, 30);
  }

  function flushAutoSummary(force = false) {
    const summary = runtime.autoSummary;
    const total = summary.training + summary.skills + summary.enhances;
    if (total && (force || summary.elapsed >= 30)) {
      const parts = [];
      if (summary.training) parts.push(`培养×${summary.training}`);
      if (summary.skills) parts.push(`技能升级×${summary.skills}`);
      if (summary.enhances) parts.push(`强化×${summary.enhances}`);
      recordAuto(`自动成长：${parts.join("、")}`);
    }
    runtime.autoSummary = { elapsed: 0, training: 0, skills: 0, enhances: 0 };
  }

  function bonfireNodeCost(level = state.bonfire.level) { return 1 + Math.floor(level / 6); }
  function countBonfireType(type, level = state.bonfire.level) {
    const index = BONFIRE_NODE_TYPES.indexOf(type);
    return index < 0 || level <= index ? 0 : Math.floor((level - 1 - index) / BONFIRE_NODE_TYPES.length) + 1;
  }
  function bonfireMultiplier(type) {
    const perNode = { attack: .035, vitality: .035, gold: .04, xp: .04, gear: .025, all: .015 }[type] || 0;
    return 1 + countBonfireType(type) * perNode;
  }
  function projectedBonfireNodes(extraEmbers) {
    let embers = state.embers + extraEmbers;
    let level = state.bonfire.level;
    let nodes = 0;
    while (nodes < 1000) {
      const cost = bonfireNodeCost(level);
      if (embers < cost) break;
      embers -= cost; level++; nodes++;
    }
    return nodes;
  }
  function lightBonfireNodes() {
    let lit = 0;
    while (lit < 1000) {
      const cost = bonfireNodeCost();
      if (state.embers < cost) break;
      state.embers -= cost;
      state.bonfire.level++;
      lit++;
    }
    if (lit) recordAuto(`篝火星图自动点亮${lit}个节点`);
    return lit;
  }
  function shouldAutoRebirth() {
    if (!state.bonfire.autoRebirth || state.completed || state.bestStage < 100 || state.bonfire.bossFailures < 5) return false;
    const reward = rebirthReward();
    const nodes = projectedBonfireNodes(reward);
    return nodes >= 3 && nodes * .035 >= .1;
  }

  function performRebirth(automatic = false) {
    if (state.bestStage < 100) { toast("通过第100关后才能篝火重整", true); return; }
    if (automatic) saveState(false);
    const reward = rebirthReward();
    const fromStage = state.bestStage;
    state.embers += reward; state.rebirths++; state.stage = 1; state.gold = 40;
    state.heroes.forEach(h => { h.level = 1; h.xp = 0; h.training = 0; h.skillLevels = [1,0,0,0]; });
    state.activeBossStage = 0; runtime.retryAt = 0; runtime.retryRemaining = 0; state.completed = false;
    state.bonfire.bossFailures = 0; state.bonfire.lastRebirthStage = fromStage;
    const lit = lightBonfireNodes();
    resetPartyRuntime(); spawnStage(1,true); saveState(); closeModal(); renderTab(); toast(`篝火重整完成，获得${reward}灵魂余烬`);
    recordAuto(`${automatic?"智能":"手动"}重整：第${fromStage}关返回起点，点亮${lit}个星图节点`);
  }
  function rebirthReward() { return Math.max(1, Math.floor(Math.pow(state.bestStage / 100, .72) * 5)); }

  function render(force = false) {
    if (!dom.stage) return;
    const zoneIndex = zoneOf(runtime.battleStage), zone = ZONES[zoneIndex], enemy = runtime.enemy;
    dom.stage.textContent = `${runtime.battleStage} / ${MAX_STAGE}`;
    dom.gold.textContent = format(state.gold); dom.dust.textContent = format(state.dust); dom.ember.textContent = format(state.embers);
    dom.teamPower.textContent = `战力 ${format(teamPower())}`;
    dom.zoneIndex.textContent = `区域 ${String(zoneIndex+1).padStart(2,"0")}`; dom.zoneName.textContent = zone.name;
    const zoneBackground=`url('assets-webp/backgrounds/zone-${String(zoneIndex+1).padStart(2,"0")}.webp')`;
    dom.battlefield.style.setProperty("--zone-bg",zoneBackground);
    dom.battlefield.parentElement?.style.setProperty("--zone-bg",zoneBackground);
    dom.eliteMark.textContent = enemy?.elite ? "精英" : ""; dom.eliteMark.classList.toggle("hidden", !enemy?.elite);
    dom.bossMark.textContent = enemy?.boss ? "BOSS" : ""; dom.bossMark.classList.toggle("hidden", !enemy?.boss);
    if (enemy) {
      dom.enemyName.textContent = enemy.boss ? bossName(runtime.battleStage) : zone.enemies[enemy.enemyType];
      dom.enemyHpBar.style.width = `${Math.max(0, enemy.hp/enemy.maxHp*100)}%`;
      dom.enemyHpText.textContent = `${format(Math.max(0,enemy.hp))} / ${format(enemy.maxHp)}`;
      dom.enemyTraits.textContent = enemy.boss ? `Boss · ${BOSS_MECHANICS[enemy.zoneIndex].name} · 进化${enemy.evo+1}` : enemy.elite ? "精英 · 强化掉落" : "普通";
      dom.timer.textContent = `${Math.max(0,runtime.timer).toFixed(1)}s`;
    }
    renderHeroes(); renderCombatStats(); renderProgress(); renderSpeed(); renderAutoFeed();
    if (drawerOpen && force) renderTab();
  }

  function renderHeroes() {
    if (globalThis.__ABYSS_TEST_MODE__) return;
    if (dom.heroCards.dataset.ready !== "true") {
      dom.heroCards.innerHTML = HERO_DEFS.map((def,i)=>`<article class="hero-card ${def.roleClass}" data-action="open-hero" data-hero="${i}" tabindex="0" role="button">
        <div class="hero-avatar" style="background-image:url('assets-v3/heroes/${def.id}/idle-1.webp')"></div>
        <h3>${def.name}<span>${def.role}</span></h3><span class="hero-level"></span><b class="hero-evolution" data-ui="evolution"></b>
        <div class="mini-bars"><div class="mini-track"><div class="mini-fill hp"></div></div><div class="mini-track"><div class="mini-fill energy"></div></div></div>
        <div class="hero-stats"><span data-ui="health"></span><span data-ui="training"></span></div>
        <div class="hero-upgrade" data-ui="next-cost"></div>
      </article>`).join("");
      dom.heroCards.dataset.ready = "true";
    }
    HERO_DEFS.forEach((def,i)=>{
      const card=dom.heroCards.querySelector(`.hero-card[data-hero="${i}"]`),h=state.heroes[i],r=runtime.heroes[i],s=heroStats(i);
      card.title=`点击查看详情 · 攻击 ${format(s.atk)} · 防御 ${format(s.def)} · 暴击 ${(s.crit*100).toFixed(1)}%`;
      card.querySelector(".hero-level").textContent=`Lv.${h.level}`;
      card.querySelector(".mini-fill.hp").style.width=`${r.alive?r.hp/r.maxHp*100:0}%`;
      card.querySelector(".mini-fill.energy").style.width=`${r.energy}%`;
      card.querySelector('[data-ui="health"]').textContent=`生命 ${format(r.hp)}/${format(r.maxHp)}`;
      card.querySelector('[data-ui="training"]').textContent=`培养 +${h.training}`;
      card.querySelector('[data-ui="next-cost"]').textContent=`下次自动培养 · ${format(trainCost(i))}金币`;
      const evolution=skillEvolutionTier(h.level);
      card.dataset.evolution=String(evolution);
      card.querySelector('[data-ui="evolution"]').textContent=skillEvolutionName(h.level);
      const sprite=$(`[data-hero="${i}"].battle-hero`);if(sprite)sprite.dataset.evolution=String(evolution);
    });
    const autoBtn=$("#autoTrainBtn");autoBtn.classList.remove("locked");autoBtn.textContent=`自动成长 · ${state.autoTrain.enabled?"开启":"暂停"}`;
  }

  function renderCombatStats(){trimStats();const damage=runtime.stats.filter(x=>x.type==="damage").reduce((s,x)=>s+x.value,0),heal=runtime.stats.filter(x=>x.type==="heal").reduce((s,x)=>s+x.value,0);dom.dps.textContent=format(damage/30);dom.heal.textContent=format(heal/30);}
  function renderAutoFeed(){
    if(!dom.autoFeed||globalThis.__ABYSS_TEST_MODE__)return;
    const visible=state.autoLog.slice(0,runtime.autoFeedExpanded?30:3);
    const signature=JSON.stringify([runtime.autoFeedExpanded,visible]);
    if(signature===runtime.autoFeedSignature)return;
    runtime.autoFeedSignature=signature;
    dom.autoFeed.classList.toggle("expanded",runtime.autoFeedExpanded);
    const toggle=dom.autoFeed.querySelector('[data-action="auto-feed-toggle"]');
    toggle.textContent=runtime.autoFeedExpanded?"收起":"展开";
    toggle.setAttribute("aria-expanded",String(runtime.autoFeedExpanded));
    dom.autoFeedList.innerHTML=visible.map(entry=>`<p class="${entry.important?"important":""}"><time>${new Date(entry.at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</time><span>${escapeHtml(entry.message)}</span></p>`).join("");
  }
  function trimStats(){const cutoff=Date.now()-30000;runtime.stats=runtime.stats.filter(x=>x.at>=cutoff);}

  function renderProgress(){
    const nextBoss=Math.min(MAX_STAGE,Math.ceil(runtime.battleStage/100)*100),zone=ZONES[zoneOf(nextBoss)],evo=bossEvolution(nextBoss);
    const mechanic=BOSS_MECHANICS[zoneOf(nextBoss)];
    dom.nextBossStage.textContent=`第${nextBoss}关`;dom.nextBossName.textContent=`${zone.boss} · ${EVOLUTIONS[evo]}`;dom.nextBossDesc.textContent=`${zone.desc} 特性「${mechanic.name}」：${mechanic.desc}。`;
    dom.bossPortrait.src=bossFrameUrl(zoneOf(nextBoss),evo);
    if(state.activeBossStage){const sec=Math.max(0,Math.ceil((runtime.retryAt-Date.now())/1000));dom.retryText.textContent=sec?`${sec}秒后自动挑战`:"准备重返Boss战";dom.challengeBtn.disabled=false;}else{dom.retryText.textContent="尚未遭遇";dom.challengeBtn.disabled=true;}
    dom.dropPreview.innerHTML=[["weapon","武器"],["armor","护甲"],["relic","饰品"]].map(([slot,name])=>`<div class="drop-slot"><b class="gear-icon" style="margin:auto;${gearIconStyle(slot,zoneOf(nextBoss)%5)}"></b>${name}</div>`).join("");
    const bossPower=Math.pow(ENEMY_HP_GROWTH,nextBoss-1)*(1+zoneOf(nextBoss)*.42),bossHp=115*bossPower*17;
    const ratio=estimatedDps()*30/bossHp;
    const winChance=Math.round(clamp(100/(1+Math.exp(-(ratio-1)*3)),3,99));
    dom.bossWinChance.textContent=`预计胜率 · ${winChance}%`;
    dom.bossWinChance.style.color=winChance>=70?"var(--good)":winChance>=40?"var(--gold)":"var(--danger)";
    let target=100,title="第100关 · 篝火重整";if(state.bestStage>=100&&state.bestStage<1000){target=1000;title="第1000关 · 四倍速"}else if(state.bestStage>=1000){target=Math.min(MAX_STAGE,Math.ceil((state.bestStage+1)/1000)*1000);title=target===MAX_STAGE?"第10000关 · 永恒篝火":`第${target}关 · 新区域`;}
    const start=target<=100?0:target- (target>=1000?1000:target===500?400:500);const pct=clamp((state.bestStage-start)/(target-start)*100,0,100);dom.milestoneTitle.textContent=title;dom.milestoneBar.style.width=`${pct}%`;dom.milestoneText.textContent=state.bestStage>=MAX_STAGE?"万阶远征已经完成。":`再推进${Math.max(0,target-state.bestStage)}关。`;
  }
  function currentSpeed(){return runtime.introSlow?1:state.speed;}
  function renderSpeed(){const max=state.bestStage>=1000?4:state.bestStage>=100?2:1;if(state.settings.autoMaxSpeed!==false)state.speed=max;else if(state.speed>max)state.speed=max;const active=currentSpeed();$$('[data-speed]').forEach(b=>{const n=Number(b.dataset.speed);b.classList.toggle('locked',n>max);b.classList.toggle('active',n===active);});}

  function renderTab(){
    if(!dom.tabContent)return;
    if(activeTab==="team")renderTeamTab();
    if(activeTab==="codex")renderCodexTab();
    if(activeTab==="rebirth")renderRebirthTab();
    if(activeTab==="settings")renderSettingsTab();
  }
  function renderTeamTab(){dom.tabContent.innerHTML=`<div class="subheading">自动成长运行中 · 金币会优先投入当前瓶颈</div><div class="tab-grid">${HERO_DEFS.map((def,i)=>{const h=state.heroes[i],s=heroStats(i);return`<div class="info-card evolution-tier-${skillEvolutionTier(h.level)}"><h3>${def.name} · ${def.role}</h3><p>攻击 <strong>${format(s.atk)}</strong>　生命 <strong>${format(s.hp)}</strong>　防御 <strong>${format(s.def)}</strong></p><p>等级 ${h.level} · 培养 +${h.training} · 技能${skillEvolutionName(h.level)}</p>${def.skills.map((name,j)=>`<div class="skill-line"><span>${name}</span><strong>${j===0?"基础技能":h.skillLevels[j]===0?`Lv.${[0,10,25,50][j]}解锁`:`Lv.${h.skillLevels[j]}`}</strong></div>`).join("")}</div>`}).join("")}</div>`;}
  function renderCodexTab(){const entries=[];for(let i=1;i<=100;i++){const stage=i*100,seen=state.codex.bosses.includes(stage);entries.push(`<div class="codex-entry ${seen?"seen":""}"><b>${seen?bossName(stage):"???"}</b><span>第${stage}关</span></div>`)}dom.tabContent.innerHTML=`<div class="subheading">Boss图鉴 · ${state.codex.bosses.length}/100</div><div class="codex-grid">${entries.join("")}</div>`;}
  function renderRebirthTab(){const can=state.bestStage>=100,nextCost=bonfireNodeCost();const start=Math.floor(state.bonfire.level/30)*30;const nodes=Array.from({length:30},(_,offset)=>{const i=start+offset,type=BONFIRE_NODE_TYPES[i%6],on=i<state.bonfire.level,next=i===state.bonfire.level;return`<div class="talent-node ${on?"on":""} ${next?"next":""}" title="${BONFIRE_NODE_NAMES[type]}">${i+1}<small>${BONFIRE_NODE_NAMES[type]}</small></div>`}).join("");dom.tabContent.innerHTML=`<div class="settings-grid"><div class="setting-card"><h3>篝火星图 · ${state.bonfire.level}级</h3><p>余烬会按固定顺序自动点亮永久增幅，不需要选择路线。下一节点需要 <strong>${nextCost}余烬</strong>。</p><div class="talent-nodes bonfire-map">${nodes}</div><p>攻击 ×${bonfireMultiplier("attack").toFixed(2)} · 生存 ×${bonfireMultiplier("vitality").toFixed(2)} · 金币 ×${bonfireMultiplier("gold").toFixed(2)}</p></div><div class="setting-card"><h3>智能重整</h3><p>任意关卡连续失败5次，且本次余烬足以带来至少约10%永久成长时自动重整。</p><div class="setting-row"><span>自动重整</span><button class="inline-btn" data-action="auto-rebirth-toggle">${state.bonfire.autoRebirth?"开启":"关闭"}</button></div><p>当前连续失败：${state.bonfire.bossFailures}/5</p><p>本次预计余烬：<strong>${rebirthReward()}</strong></p><button class="primary-btn" style="width:180px" data-action="rebirth-open" ${can?"":"disabled"}>${can?"立即重整":"第100关后解锁"}</button></div><div class="setting-card"><h3>远征记录</h3><p>历史最高：第${state.bestStage}关</p><p>重整次数：${state.rebirths}</p><p>累计击杀：${format(state.totalKills)}</p></div></div>`;}
  function renderSettingsTab(){
    dom.tabContent.innerHTML=`<div class="settings-grid">
      <div class="setting-card"><h3>界面与性能</h3>
        <p>界面缩放</p><div class="setting-actions">${[90,100,110,125].map(x=>`<button class="inline-btn" data-action="ui-scale" data-value="${x}" ${state.settings.uiScale===x?"disabled":""}>${x}%</button>`).join("")}</div>
        <div class="setting-row"><span>高对比度</span><button class="inline-btn" data-action="contrast-toggle">${state.settings.highContrast?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>减少动态效果</span><button class="inline-btn" data-action="motion-toggle">${state.settings.reduceMotion?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>环境粒子</span><button class="inline-btn" data-action="particles-toggle">${state.settings.particles?"开启":"关闭"}</button></div>
        <div class="setting-row"><span>伤害与治疗数字</span><button class="inline-btn" data-action="damage-toggle">${state.settings.showDamage?"显示":"隐藏"}</button></div>
      </div>
      <div class="setting-card"><h3>自动规则</h3><div class="setting-row"><span>自动成长</span><button class="inline-btn" data-action="auto-growth-toggle">${state.autoTrain.enabled?"开启":"暂停"}</button></div><div class="setting-row"><span>自动最高倍速</span><button class="inline-btn" data-action="auto-speed-toggle">${state.settings.autoMaxSpeed!==false?"开启":"关闭"}</button></div><p>掉落装备自动比较换装，旧装备自动转化为粉尘；粉尘自动强化收益最高的部位。</p></div>
      <div class="setting-card"><h3>存档管理</h3><p>每5秒自动保存，本地存档不会上传。v3为全新数值版本，不兼容旧版存档。</p><div class="setting-actions"><button class="inline-btn" data-action="save">立即保存</button><button class="inline-btn" data-action="export">导出当前存档</button><button class="inline-btn" data-action="import">导入v3存档</button><button class="inline-btn danger-btn" data-action="clear-open">清空进度</button></div></div>
      <div class="setting-card"><h3>挂机规则</h3><p>网页在前台或后台标签页时继续推进关卡；完全关闭网页后只累计金币和经验，单次最多12小时。</p><button class="inline-btn" data-action="guide-reset">重新查看操作提示</button></div>
    </div>`;
  }

  function handleAction(action,data){
    if(action==="train")buyTraining(Number(data.hero));
    if(action==="skill"){const i=Number(data.hero),j=Number(data.skill),cost=skillCost(i,j);if(state.gold<cost)toast("金币不足",true);else{state.gold-=cost;state.heroes[i].skillLevels[j]++;renderTab();}}
    if(action==="priority"){state.autoTrain.priority=data.value;renderTab();}
    if(action==="save")saveState(true);
    if(action==="export")exportSave();
    if(action==="copy-save"){const text=$("#saveText")?.value||"";navigator.clipboard?.writeText(text).then(()=>toast("存档已复制到剪贴板")).catch(()=>toast("请手动选择并复制文本",true));}
    if(action==="import")importSaveModal();
    if(action==="clear-open")clearSaveModal();
    if(action==="clear-confirm"){safeStorageRemove(SAVE_KEY);location.reload();}
    if(action==="import-confirm")importSave();
    if(action==="rebirth-open")rebirthModal();
    if(action==="rebirth-confirm")performRebirth();
    if(action==="restart-expedition-open")restartExpeditionModal();
    if(action==="restart-expedition-confirm")restartExpedition();
    if(action==="open-hero")openDrawer("team");
    if(action==="ui-scale"){state.settings.uiScale=clamp(Number(data.value)||100,90,125);applyDisplaySettings();renderTab();saveState();}
    if(action==="contrast-toggle"){state.settings.highContrast=!state.settings.highContrast;applyDisplaySettings();renderTab();saveState();}
    if(action==="motion-toggle"){state.settings.reduceMotion=!state.settings.reduceMotion;applyDisplaySettings();renderTab();saveState();}
    if(action==="particles-toggle"){state.settings.particles=!state.settings.particles;applyDisplaySettings();renderTab();saveState();}
    if(action==="damage-toggle"){state.settings.showDamage=!state.settings.showDamage;renderTab();saveState();}
    if(action==="auto-growth-toggle"){toggleAutoTrain();renderTab();saveState();}
    if(action==="auto-speed-toggle"){state.settings.autoMaxSpeed=state.settings.autoMaxSpeed===false;renderSpeed();renderTab();saveState();}
    if(action==="auto-rebirth-toggle"){state.bonfire.autoRebirth=!state.bonfire.autoRebirth;renderTab();saveState();}
    if(action==="auto-feed-toggle"){runtime.autoFeedExpanded=!runtime.autoFeedExpanded;runtime.autoFeedSignature="";renderAutoFeed();}
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
    dom.guideTip.innerHTML=`战斗、成长、换装和强化都会自动进行。使用底部功能栏查看队伍成长、篝火星图与图鉴。<button class="inline-btn" data-action="guide-close">知道了</button>`;
    dom.guideTip.classList.remove("hidden");
  }

  function updateEnemySprite(){
    const e=runtime.enemy;if(!e)return;
    dom.enemyUnit.classList.toggle("final-boss",e.boss&&runtime.battleStage===MAX_STAGE);
    if(e.boss){
      stopSpriteAnimation(dom.enemySprite);
      dom.enemySprite.classList.remove("enemy-attacking");
      dom.enemySprite.src=bossFrameUrl(e.zoneIndex,e.evo);
    }else{
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
    dom.enemySprite.classList.toggle("enemy-attacking",action==="attack");
    const enemy=e;
    playSprite(dom.enemySprite,enemyFrameUrls(e.zoneIndex,e.enemyType,action),action==="attack"?420/currentSpeed():920,action!=="attack",()=>{
      if(runtime.enemy===enemy&&!runtime.enemy.boss){dom.enemySprite.classList.remove("enemy-attacking");setEnemyAction("idle");}
    });
  }
  function gearIconStyle(slot,rarityIndex=0){const col={weapon:0,armor:1,relic:2}[slot]??0,row=clamp(rarityIndex,0,4);return`background-image:url('assets-webp/ui/equipment.webp');background-size:300% 500%;background-position:${col/2*100}% ${row/4*100}%`;}
  function setHeroAction(i,action){
    const el=$(`[data-hero="${i}"].battle-hero`);if(!el)return;
    el.classList.remove("action-attack","action-skill","action-hit","down");
    if(action==="attack")el.classList.add("action-attack");
    if(action==="skill"||action==="ultimate")el.classList.add("action-skill");
    if(action==="hit")el.classList.add("action-hit");
    if(action==="down")el.classList.add("down");
    const duration={idle:900,move:620,attack:450,skill:650,ultimate:720,hit:280,down:700}[action]/currentSpeed();
    playSprite(el,heroFrameUrls(HERO_DEFS[i].id,action),duration,action==="idle",()=>{
      if(action!=="down"&&runtime.heroes[i].alive)setHeroAction(i,"idle");
    });
  }
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
  function showBossIntro(stage){
    const token=++runtime.introToken;
    runtime.introSlow=true;
    dom.bossTitle.textContent=`${bossName(stage)} · ${BOSS_MECHANICS[zoneOf(stage)].name}`;
    dom.bossIntro.classList.remove("hidden");
    renderSpeed();
    setTimeout(()=>{if(token!==runtime.introToken)return;runtime.introSlow=false;dom.bossIntro.classList.add("hidden");renderSpeed();},2800);
  }
  function discoverEnemy(){const e=runtime.enemy;if(e.boss)return;const id=`${e.zoneIndex}-${e.enemyType}`;if(!state.codex.enemies.includes(id))state.codex.enemies.push(id);}
  function bossName(stage){const zone=ZONES[zoneOf(stage)],evo=bossEvolution(stage);return `${zone.boss} · ${EVOLUTIONS[evo]}`;}

  function floatNumber(text,x,y,crit=false,heal=false){const el=document.createElement("span");el.className=`float-number ${crit?"crit":""} ${heal?"heal":""}`;el.textContent=text;el.style.left=`${x}%`;el.style.top=`${y}%`;dom.damage.appendChild(el);setTimeout(()=>el.remove(),950);}
  function toastMini(text,x,y){floatNumber(text,x,y,false,true);}
  function toast(message,bad=false){if(runtime?.backgroundMode)return;const el=document.createElement("div");el.className=`toast ${bad?"bad":""}`;el.textContent=message;$("#toastStack").appendChild(el);setTimeout(()=>el.remove(),3200);}
  function showOfflineReport(r){openModal(`<h2 id="modalTitle">挂机收益</h2><p>网页关闭期间关卡保持在原位；金币与经验结算后，系统已自动完成最有效的成长。</p><div class="tab-grid"><div class="info-card"><h3>离开时间</h3><strong>${formatDuration(r.seconds)}</strong></div><div class="info-card"><h3>获得金币</h3><strong>${format(r.gold)}</strong></div><div class="info-card"><h3>每人经验</h3><strong>${format(r.xp)}</strong></div><div class="info-card"><h3>自动成长</h3><strong>${format(r.upgrades||0)}次</strong></div></div>${r.seconds>=OFFLINE_CAP-1?'<p>已达到12小时离线储存上限。</p>':''}`);}
  function rebirthModal(){openModal(`<h2 id="modalTitle">点燃重整篝火？</h2><p>返回第1关并重置金币、角色等级、技能等级与培养；装备、图鉴、篝火星图及最高纪录保留。</p><p>本次获得 <strong>${rebirthReward()} 灵魂余烬</strong>，并自动点亮星图节点。</p><button class="primary-btn" data-action="rebirth-confirm">确认重整</button>`);}
  function exportSave(){saveState();const data=btoa(unescape(encodeURIComponent(JSON.stringify(state))));openModal(`<h2 id="modalTitle">导出存档</h2><p>复制下方文本并妥善保存。</p><textarea id="saveText">${data}</textarea><button class="inline-btn" data-action="copy-save">手动复制文本</button>`);const ta=$("#saveText");ta.focus();ta.select();navigator.clipboard?.writeText(data).then(()=>toast("存档已复制到剪贴板")).catch(()=>{});}
  function importSaveModal(){openModal(`<h2 id="modalTitle">导入存档</h2><p>粘贴存档文本。当前进度将在验证成功后被替换。</p><textarea id="saveText" placeholder="在此粘贴存档"></textarea><button class="primary-btn" data-action="import-confirm">验证并导入</button>`);}
  function importSave(){
    try{
      const text=$("#saveText").value.trim();
      if(!text||text.length>SAVE_TEXT_LIMIT)throw new Error("存档为空或超过1MB限制");
      const parsed=JSON.parse(decodeURIComponent(escape(atob(text))));
      if(!parsed||Object.getPrototypeOf(parsed)!==Object.prototype||parsed.version!==SAVE_VERSION)throw new Error("存档版本不兼容");
      state=mergeState(parsed);saveState();location.reload();
    }catch(error){console.warn("存档导入失败",error);toast("存档无效：请确认是完整的v3导出文本",true);}
  }
  function clearSaveModal(){openModal(`<h2 id="modalTitle">清空全部进度？</h2><p>此操作无法恢复。建议先导出存档。</p><button class="inline-btn danger-btn" data-action="clear-confirm">确认永久清空</button>`);}
  function restartExpeditionModal(){openModal(`<h2 id="modalTitle">重新开始万阶远征？</h2><p>将清空角色、装备、图鉴、篝火与全部纪录，并从第1关重新开始。此操作无法恢复，建议先导出当前存档。</p><button class="inline-btn danger-btn" data-action="restart-expedition-confirm">确认清空并重新开始</button>`);}
  function restartExpedition(){safeStorageRemove(SAVE_KEY);state=initialState();saveState();location.reload();}
  function openModal(html){modalReturnFocus=document.activeElement;dom.modalBody.innerHTML=html;dom.modal.classList.remove("hidden");runtime.paused=true;setTimeout(()=>focusFirst(dom.modal),0);}
  function closeModal(){dom.modal.classList.add("hidden");runtime.paused=false;if(modalReturnFocus?.focus)modalReturnFocus.focus();modalReturnFocus=null;}
  function format(value){if(!Number.isFinite(value))return"∞";const abs=Math.abs(value);const units=[[1e24,"秭"],[1e20,"垓"],[1e16,"京"],[1e12,"兆"],[1e8,"亿"],[1e4,"万"]];for(const[u,n]of units)if(abs>=u)return`${(value/u).toFixed(abs>=u*100?0:abs>=u*10?1:2)}${n}`;return Math.floor(value).toLocaleString("zh-CN");}
  function formatDuration(sec){sec=Math.floor(sec);const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return`${h?`${h}小时`:""}${m?`${m}分钟`:""}${!h&&s?`${s}秒`:""}`||"0秒";}
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);}
  function visualRandom(){visualRandomState=(1664525*visualRandomState+1013904223)>>>0;return visualRandomState/4294967296;}

  if (globalThis.__ABYSS_TEST_MODE__) {
    window.__ABYSS_TEST__ = {
      snapshot: () => JSON.parse(JSON.stringify({ state, runtime: { battleStage: runtime.battleStage, timer: runtime.timer, retryAt: runtime.retryAt, retryRemaining: runtime.retryRemaining, enemyAttack: runtime.enemyAttack, enemy: runtime.enemy, heroes: runtime.heroes } })),
      setStage: stage => { state.completed = false; state.stage = clamp(stage, 1, MAX_STAGE); resetPartyRuntime(); spawnStage(state.stage, true); },
      winNow: () => { if (runtime.enemy) { runtime.enemy.hp = 0; winStage(true); advanceTransition(KILL_TRANSITION_SECONDS); } },
      beginWinNow: () => { if (runtime.enemy) { runtime.enemy.hp = 0; winStage(true); } },
      failNow: () => failStage(true),
      retryNow: () => { runtime.retryAt = 0; runtime.retryRemaining = 0; maybeAutoChallenge(); },
      backgroundSeconds: seconds => simulateBackground(seconds * state.speed),
      detailedSeconds: seconds => simulateForeground(seconds),
      openSeconds: seconds => { let remaining = seconds; while (remaining > 0 && !state.completed) { renderSpeed(); const realChunk = Math.min(600, remaining); simulateBackground(realChunk * state.speed); remaining -= realChunk; } },
      setBestStage: stage => { state.bestStage = clamp(stage, 1, MAX_STAGE); },
      rebirthNow: () => performRebirth(),
      sanitize: value => mergeState(value),
      escapeHtml,
      bossMechanic: stage => ({ ...BOSS_MECHANICS[zoneOf(stage)] }),
      heroStats: index => ({ ...heroStats(index) }),
      setHeroLevel: (index, level) => { state.heroes[index].level = clamp(Math.floor(level), 1, 100000); refreshPartyStats(); },
      heroHitNow: amount => dealDamage(amount, 1, false),
      enemyAttackNow: () => enemyAttack()
    };
  }
  init();
})();
