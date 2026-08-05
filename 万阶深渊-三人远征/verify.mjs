import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];
const ok = (condition, message) => { if (!condition) errors.push(message); };
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const css = read("styles.css");
const js = read("game.js");
const rules = read("rules.js");
const saveState = read("save-state.js");

ok(html.includes("万阶深渊"), "HTML 缺少游戏标题");
ok(html.includes('src="game.js"'), "HTML 未引用 game.js");
ok(html.includes('src="rules.js"'), "HTML 未引用共享规则模块 rules.js");
ok(html.includes('src="save-state.js"'), "HTML 未引用安全存档模块 save-state.js");
ok(html.includes('href="styles.css"'), "HTML 未引用 styles.css");
ok((html.match(/class="tab-btn"/g) || []).length === 4, "底部功能入口不是精简后的 4 个");
ok(html.includes('id="autoFeed"') && html.includes('id="autoFeedList"'), "缺少主界面自动成长记录");
ok(rules.includes("const MAX_STAGE = 10000"), "关卡上限不是 10000");
ok(rules.includes("stage % 100 === 0"), "缺少每 100 关 Boss 规则");
ok(rules.includes("const BOSS_MECHANICS") && js.includes("BOSS_MECHANICS[enemy.zoneIndex]"), "缺少10族Boss标志机制");
ok(js.includes("runtime.introSlow=true") && js.includes("function currentSpeed()"), "首次Boss登场未强制使用1倍速");
ok(js.includes("skillEvolutionTier") && js.includes("[100, 200]"), "缺少100/200级技能进化");
ok(html.includes('data-action="restart-expedition-open"') && js.includes("restartExpeditionModal"), "万阶通关后缺少二次确认的重新远征流程");
ok(js.includes('if (state.completed) dom.victory.classList.remove("hidden")'), "通关存档重开页面后未恢复终点界面");
ok(rules.includes("const OFFLINE_CAP = 12 * 60 * 60"), "离线收益上限不是 12 小时");
ok(rules.includes("const ENEMY_HP_GROWTH = 1.001065") && rules.includes("const ENEMY_ATK_GROWTH = 1.0006"), "游戏数值曲线未使用已校准参数");
ok(js.includes("state.bestStage = Math.max(state.bestStage, runtime.battleStage)"), "最高通关记录存在偏移风险");
ok(js.includes("maybeAutoChallenge()"), "缺少 Boss 自动重试入口");
ok(js.includes("function renderAutoFeed") && js.includes("function flushAutoSummary"), "缺少自动日志汇总与增量渲染");
ok(saveState.includes("function mergeState") && saveState.includes("RARITY_NAMES") && saveState.includes("message:"), "安全存档模块缺少字段白名单校验");
ok(js.includes("function trapFocus") && js.includes("handleVisibilityChange") && css.includes(":focus-visible"), "缺少键盘焦点或隐藏标签页性能处理");
ok(!js.includes("renderTalentTab") && !js.includes("renderGearTab") && !js.includes("state.bag") && !js.includes("TALENTS"), "已取消的构筑或手动背包代码仍有残留");
ok(css.includes("image-rendering:pixelated"), "缺少像素图无模糊渲染规则");

const expectedWebp = [
  ...Array.from({ length: 10 }, (_, i) => `assets-webp/backgrounds/zone-${String(i + 1).padStart(2, "0")}.webp`),
  "assets-webp/ui/equipment.webp",
  "assets-webp/ui/icons-v2.webp"
];
const expectedV3 = [
  ...["yutong", "wangshang", "chongrui"].flatMap(hero =>
    ["idle", "move", "attack", "skill", "ultimate", "hit", "down"].flatMap(action =>
      Array.from({ length: 4 }, (_, i) => `assets-v3/heroes/${hero}/${action}-${i + 1}.webp`))),
  ...Array.from({ length: 10 }, (_, zone) =>
    Array.from({ length: 3 }, (_, enemy) =>
      ["idle", "attack"].flatMap(action =>
        Array.from({ length: 4 }, (_, i) => `assets-v3/enemies/zone-${String(zone + 1).padStart(2, "0")}/enemy-${String(enemy + 1).padStart(2, "0")}-${action}-${i + 1}.webp`))).flat()).flat(),
  ...Array.from({ length: 10 }, (_, family) =>
    Array.from({ length: 10 }, (_, form) => `assets-v3/bosses/family-${String(family + 1).padStart(2, "0")}/form-${String(form + 1).padStart(2, "0")}.webp`)).flat()
];

function webpInfo(file) {
  const data = fs.readFileSync(path.join(root, file));
  ok(data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP", `${file} 不是有效 WebP`);
  return { bytes: data.length };
}

let totalBytes = 0;

for (const file of expectedWebp) {
  const full = path.join(root, file);
  ok(fs.existsSync(full), `缺少 WebP 运行素材：${file}`);
  if (!fs.existsSync(full)) continue;
  totalBytes += webpInfo(file).bytes;
}

for (const file of expectedV3) {
  const full = path.join(root, file);
  ok(fs.existsSync(full), `缺少 v3 独立帧：${file}`);
  if (!fs.existsSync(full)) continue;
  totalBytes += webpInfo(file).bytes;
}

ok(!js.includes(".png") && !css.includes(".png"), "运行代码仍引用 PNG，WebP 切换不完整");
ok(js.includes("scheduleZonePreload(zoneIndex)"), "缺少当前区域与下一地区预加载策略");
ok(js.includes("function playSprite"), "缺少独立图片帧播放逻辑");
ok(!js.includes("assets-webp/heroes/") && !js.includes("assets-webp/enemies/") && !js.includes("assets-webp/bosses/"), "战斗单位仍在使用旧图集");
ok(html.includes('<img id="enemySprite"'), "敌人未改为独立 img 图层");
ok(!fs.existsSync(path.join(root, "assets")) && !fs.existsSync(path.join(root, "assets-v2")), "发布分支仍包含旧版素材目录");
ok(fs.existsSync(path.join(root, "balance-sim.mjs")), "缺少80小时快速数值模拟器");

if (errors.length) {
  console.error(errors.map(x => `- ${x}`).join("\n"));
  process.exit(1);
}
const finalAssetCount = expectedWebp.length + expectedV3.length;
console.log(`验证通过：${finalAssetCount} 个最终生成素材，合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB。`);
console.log("规则通过：10000 关、每 100 关 Boss、12 小时关闭收益、后台补算与 Boss 自动重试。");
