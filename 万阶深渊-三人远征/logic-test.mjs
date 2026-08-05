import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...xs) { xs.forEach(x => this.values.add(x)); }
  remove(...xs) { xs.forEach(x => this.values.delete(x)); }
  toggle(x, force) { if (force === undefined ? !this.values.has(x) : force) this.values.add(x); else this.values.delete(x); }
  contains(x) { return this.values.has(x); }
}

class FakeElement {
  constructor() {
    this.innerHTML = ""; this.textContent = ""; this.value = ""; this.disabled = false;
    this.dataset = {}; this.classList = new FakeClassList(); this.children = [];
    this.style = { setProperty() {} }; this.offsetWidth = 100;
  }
  addEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  focus() {}
  select() {}
  closest() { return null; }
}

function createContext(saved = null, saveKey = "abyss-expedition-v3", seed = 123456789) {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new FakeElement());
    return elements.get(selector);
  };
  const speedButtons = [1, 2, 4].map(speed => { const el = new FakeElement(); el.dataset.speed = String(speed); return el; });
  const document = {
    querySelector: get,
    querySelectorAll: selector => selector === "[data-speed]" ? speedButtons : [],
    createElement: () => new FakeElement(),
    addEventListener() {}
  };
  const storage = new Map(saved ? [[saveKey, JSON.stringify(saved)]] : []);
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  let randomState = seed >>> 0;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const context = {
    console, document, localStorage, navigator: {}, location: { reload() {} },
    Math: seededMath,
    performance: { now: () => 1000 },
    addEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    btoa: value => Buffer.from(value, "binary").toString("base64"), atob: value => Buffer.from(value, "base64").toString("binary"),
    __ABYSS_TEST_MODE__: true
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("game.js", "utf8"), context, { filename: "game.js" });
  const api = context.__ABYSS_TEST__;
  api.storageKeys = () => [...storage.keys()];
  return api;
}

const api = createContext();
let snap = api.snapshot();
assert.equal(snap.state.stage, 1);
assert.equal(snap.runtime.enemy.boss, false);

api.setStage(100);
snap = api.snapshot();
assert.equal(snap.runtime.enemy.boss, true);
assert.equal(snap.runtime.enemy.evo, 0);
api.winNow();
snap = api.snapshot();
assert.equal(snap.state.stage, 101);
assert.equal(snap.state.bestStage, 100, "Boss 通关记录不能偏移到 101");

api.setStage(200);
api.failNow();
snap = api.snapshot();
assert.equal(snap.state.stage, 199);
assert.equal(snap.state.activeBossStage, 200);
api.retryNow();
assert.equal(api.snapshot().runtime.battleStage, 200, "30 秒重试入口必须能返回 Boss 关");

api.setStage(300);
api.failNow();
api.backgroundSeconds(31);
assert.equal(api.snapshot().runtime.battleStage, 300, "后台等待满 30 秒后必须自动返回 Boss 关");

api.setStage(1000);
snap = api.snapshot();
assert.equal(snap.runtime.enemy.zoneIndex, 0);
assert.equal(snap.runtime.enemy.evo, 9);
api.setStage(1001);
assert.equal(api.snapshot().runtime.enemy.zoneIndex, 1, "第 1001 关必须进入第二区域");

api.setStage(10000);
snap = api.snapshot();
assert.equal(snap.runtime.enemy.boss, true);
assert.equal(snap.runtime.enemy.zoneIndex, 9);
assert.equal(snap.runtime.enemy.evo, 9);
api.winNow();
snap = api.snapshot();
assert.equal(snap.state.completed, true);
assert.equal(snap.state.stage, 10000);
assert.equal(snap.state.bestStage, 10000);

const oneHourAgo = Date.now() - 3600_000;
const offline = createContext({ stage: 50, bestStage: 49, gold: 100, lastSavedAt: oneHourAgo });
snap = offline.snapshot();
assert.equal(snap.state.stage, 50, "关闭网页后不得推进关卡");
assert.ok(snap.state.heroes.some(hero => hero.training > 0 || hero.level > 1), "关闭收益必须结算为金币、经验并自动用于成长");

const legacy = createContext({ stage: 999, bestStage: 999, gold: 999999 }, "abyss-expedition-v1");
assert.equal(legacy.snapshot().state.stage, 1, "v3 必须从全新存档开始");
assert.ok(!legacy.storageKeys().includes("abyss-expedition-v1"), "旧版存档键必须按产品约定直接删除");

const paritySave = { version: 3, stage: 8, bestStage: 8, gold: 0, autoTrain: { enabled: false, priority: "智能" }, lastSavedAt: Date.now() };
const foreground = createContext(paritySave, "abyss-expedition-v3", 42);
const background = createContext(paritySave, "abyss-expedition-v3", 42);
foreground.detailedSeconds(5);
background.backgroundSeconds(5);
const frontSnap = foreground.snapshot();
const backSnap = background.snapshot();
assert.equal(backSnap.runtime.battleStage, frontSnap.runtime.battleStage, "前后台必须推进到同一关卡");
assert.ok(Math.abs(backSnap.runtime.enemy.hp - frontSnap.runtime.enemy.hp) < 1e-6, "前后台敌人剩余生命必须一致");
assert.equal(JSON.stringify(backSnap.runtime.heroes.map(hero => [hero.hp, hero.energy, hero.alive])), JSON.stringify(frontSnap.runtime.heroes.map(hero => [hero.hp, hero.energy, hero.alive])), "前后台队伍状态必须一致");

const longBackground = createContext({ version: 3, stage: 1, bestStage: 1, gold: 40, lastSavedAt: Date.now() }, "abyss-expedition-v3", 7);
const longStart = Date.now();
longBackground.backgroundSeconds(3600);
assert.ok(Date.now() - longStart < 5000, "一小时后台补算必须在5秒内完成");
assert.ok(longBackground.snapshot().state.totalKills > 0, "长时间后台补算必须实际执行战斗");

const autoRebirth = createContext({ version: 3, stage: 500, bestStage: 500, gold: 0, lastSavedAt: Date.now() }, "abyss-expedition-v3", 99);
autoRebirth.setBestStage(500);
autoRebirth.setStage(500);
for (let attempt = 0; attempt < 5; attempt++) {
  autoRebirth.failNow();
  if (attempt < 4) autoRebirth.retryNow();
}
snap = autoRebirth.snapshot();
assert.equal(snap.state.stage, 1, "连续五次Boss失败且收益充足时必须智能重整");
assert.equal(snap.state.rebirths, 1, "智能重整次数必须正确累计");
assert.ok(snap.state.bonfire.level >= 3, "重整余烬必须自动点亮篝火星图");

if (process.argv.includes("--balance")) {
  const hoursArg = process.argv.find(arg => arg.startsWith("--hours="));
  const hours = Math.max(1, Number(hoursArg?.split("=")[1]) || 80);
  const balance = createContext({ version: 3, stage: 1, bestStage: 1, gold: 40, lastSavedAt: Date.now() }, "abyss-expedition-v3", 20260805);
  const balanceStart = Date.now();
  balance.openSeconds(hours * 3600);
  const balanceSnap = balance.snapshot();
  console.log(`${hours}小时平衡模拟`, JSON.stringify({ stage: balanceSnap.state.stage, bestStage: balanceSnap.state.bestStage, completed: balanceSnap.state.completed, rebirths: balanceSnap.state.rebirths, bonfire: balanceSnap.state.bonfire.level, elapsedMs: Date.now() - balanceStart }));
}

console.log("逻辑测试通过：Boss规则、区域边界、失败重试、智能重整、篝火星图、前后台一致性、10000关终点、关闭收益与v3强制开档均符合设计。");
