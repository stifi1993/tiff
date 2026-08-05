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

function createContext(saved = null) {
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
  const storage = new Map(saved ? [["abyss-expedition-v1", JSON.stringify(saved)]] : []);
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const context = {
    console, document, localStorage, navigator: {}, location: { reload() {} },
    performance: { now: () => 1000 },
    addEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    btoa: value => Buffer.from(value, "binary").toString("base64"), atob: value => Buffer.from(value, "base64").toString("binary"),
    __ABYSS_TEST_MODE__: true
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("game.js", "utf8"), context, { filename: "game.js" });
  return context.__ABYSS_TEST__;
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
assert.ok(snap.state.gold > 100, "关闭网页后应继续累计金币");

console.log("逻辑测试通过：Boss 规则、区域边界、失败重试、10000 关终点与关闭收益均符合设计。 ");
