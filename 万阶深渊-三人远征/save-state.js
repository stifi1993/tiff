(() => {
  "use strict";

  const { MAX_STAGE, HERO_DEFS } = globalThis.AbyssRules;
  const SAVE_VERSION = 3;
  const RARITY_NAMES = ["普通", "稀有", "史诗", "传说", "神话"];
  const SLOTS = ["weapon", "armor", "relic"];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function initialState() {
    return {
      version: SAVE_VERSION, stage: 1, bestStage: 1, gold: 40, dust: 0, embers: 0, totalKills: 0,
      rebirths: 0, speed: 1, completed: false, lastSavedAt: Date.now(), activeBossStage: 0,
      heroes: HERO_DEFS.map(() => ({ level: 1, xp: 0, training: 0, skillLevels: [1, 0, 0, 0], gear: { weapon: null, armor: null, relic: null } })),
      autoTrain: { enabled: true, priority: "智能" },
      codex: { bosses: [], enemies: [], gear: [] }, firstZoneSeen: [0], firstBossSeen: [],
      autoLog: [], autoTotals: { training: 0, skills: 0, equips: 0, enhances: 0 },
      bonfire: { level: 0, autoRebirth: true, bossFailures: 0, lastRebirthStage: 0 },
      settings: { showDamage: true, uiScale: 100, highContrast: false, reduceMotion: false, particles: true, autoMaxSpeed: true },
      guide: { step: 0, dismissed: false }
    };
  }

  function mergeState(saved) {
    const base = initialState();
    if (!saved || typeof saved !== "object") return base;
    const number = (value, fallback, min = 0, max = Number.MAX_VALUE) => Number.isFinite(Number(value)) ? clamp(Number(value), min, max) : fallback;
    const integer = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.floor(number(value, fallback, min, max));
    const boolean = (value, fallback) => typeof value === "boolean" ? value : fallback;
    const list = value => Array.isArray(value) ? value : [];
    const gear = (value, heroIndex, slot) => {
      if (!value || typeof value !== "object") return null;
      const rawRarity = Number(value.rarityIndex), rawBase = Number(value.base);
      if (!Number.isInteger(rawRarity) || rawRarity < 0 || rawRarity >= RARITY_NAMES.length || !Number.isFinite(rawBase) || rawBase < 1) return null;
      return {
        id: String(value.id || `restored-${heroIndex}-${slot}`).slice(0, 80), heroIndex, slot,
        rarity: RARITY_NAMES[rawRarity], rarityIndex: rawRarity,
        base: integer(value.base, 1, 1, 1e12), enhance: integer(value.enhance, 0, 0, 20),
        stage: integer(value.stage, 1, 1, MAX_STAGE)
      };
    };
    const merged = initialState();
    merged.stage = integer(saved.stage, 1, 1, MAX_STAGE);
    merged.bestStage = integer(saved.bestStage, 1, 1, MAX_STAGE);
    merged.gold = number(saved.gold, base.gold, 0, 1e300);
    merged.dust = number(saved.dust, 0, 0, 1e300);
    merged.embers = number(saved.embers, 0, 0, 1e300);
    merged.totalKills = integer(saved.totalKills, 0, 0, 1e12);
    merged.rebirths = integer(saved.rebirths, 0, 0, 1e9);
    merged.speed = [1, 2, 4].includes(Number(saved.speed)) ? Number(saved.speed) : 1;
    merged.completed = boolean(saved.completed, false) && merged.stage === MAX_STAGE;
    merged.lastSavedAt = integer(saved.lastSavedAt, Date.now(), 0, Date.now() + 86400000);
    merged.activeBossStage = integer(saved.activeBossStage, 0, 0, MAX_STAGE);
    if (merged.activeBossStage % 100 !== 0) merged.activeBossStage = 0;
    merged.heroes = base.heroes.map((fallback, index) => {
      const source = saved.heroes?.[index] && typeof saved.heroes[index] === "object" ? saved.heroes[index] : {};
      const levels = list(source.skillLevels);
      return {
        level: integer(source.level, 1, 1, 100000), xp: number(source.xp, 0, 0, 1e300),
        training: integer(source.training, 0, 0, 100000),
        skillLevels: [0, 1, 2, 3].map(skill => skill === 0 ? Math.max(1, integer(levels[skill], 1, 0, 100000)) : integer(levels[skill], 0, 0, 100000)),
        gear: Object.fromEntries(SLOTS.map(slot => [slot, gear(source.gear?.[slot], index, slot)]))
      };
    });
    merged.autoTrain = { enabled: boolean(saved.autoTrain?.enabled, true), priority: "智能" };
    const bossStages = value => [...new Set(list(value).map(Number).filter(stage => Number.isInteger(stage) && stage >= 100 && stage <= MAX_STAGE && stage % 100 === 0))].slice(0, 100);
    merged.codex = {
      bosses: bossStages(saved.codex?.bosses),
      enemies: [...new Set(list(saved.codex?.enemies).map(String).filter(value => /^\d-\d$/.test(value)))].slice(0, 30),
      gear: [...new Set(list(saved.codex?.gear).map(String).filter(value => RARITY_NAMES.includes(value)))].slice(0, RARITY_NAMES.length)
    };
    merged.firstZoneSeen = [...new Set(list(saved.firstZoneSeen).map(value => integer(value, -1, 0, 9)).filter(value => value >= 0))].slice(0, 10);
    if (!merged.firstZoneSeen.includes(0)) merged.firstZoneSeen.unshift(0);
    merged.firstBossSeen = bossStages(saved.firstBossSeen);
    merged.autoLog = list(saved.autoLog).slice(0, 30).map(entry => ({
      at: integer(entry?.at, Date.now(), 0, Date.now() + 86400000),
      message: String(entry?.message || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160),
      important: Boolean(entry?.important)
    })).filter(entry => entry.message);
    merged.autoTotals = Object.fromEntries(Object.keys(base.autoTotals).map(key => [key, integer(saved.autoTotals?.[key], 0, 0, 1e12)]));
    merged.bonfire = {
      level: integer(saved.bonfire?.level, 0, 0, 100000), autoRebirth: boolean(saved.bonfire?.autoRebirth, true),
      bossFailures: integer(saved.bonfire?.bossFailures, 0, 0, 5), lastRebirthStage: integer(saved.bonfire?.lastRebirthStage, 0, 0, MAX_STAGE)
    };
    merged.settings = {
      showDamage: boolean(saved.settings?.showDamage, true), uiScale: [90, 100, 110, 125].includes(Number(saved.settings?.uiScale)) ? Number(saved.settings.uiScale) : 100,
      highContrast: boolean(saved.settings?.highContrast, false), reduceMotion: boolean(saved.settings?.reduceMotion, false),
      particles: boolean(saved.settings?.particles, true), autoMaxSpeed: boolean(saved.settings?.autoMaxSpeed, true)
    };
    merged.guide = { step: integer(saved.guide?.step, 0, 0, 20), dismissed: boolean(saved.guide?.dismissed, false) };
    merged.autoTrainClock = number(saved.autoTrainClock, 0, 0, 1);
    return merged;
  }

  function safeStorageRemove(storage, key) {
    try { storage.removeItem(key); return true; } catch (error) { console.warn("无法清理本地存档", error); return false; }
  }

  globalThis.AbyssSaveState = Object.freeze({ initialState, mergeState, safeStorageRemove });
})();
