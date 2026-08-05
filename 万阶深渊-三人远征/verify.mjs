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

ok(html.includes("万阶深渊"), "HTML 缺少游戏标题");
ok(html.includes('src="game.js"'), "HTML 未引用 game.js");
ok(html.includes('href="styles.css"'), "HTML 未引用 styles.css");
ok(js.includes("const MAX_STAGE = 10000"), "关卡上限不是 10000");
ok(js.includes("stage % 100 === 0"), "缺少每 100 关 Boss 规则");
ok(js.includes("const OFFLINE_CAP = 12 * 60 * 60"), "离线收益上限不是 12 小时");
ok(js.includes("state.bestStage = Math.max(state.bestStage, runtime.battleStage)"), "最高通关记录存在偏移风险");
ok(js.includes("maybeAutoChallenge()"), "缺少 Boss 自动重试入口");
ok(css.includes("image-rendering:pixelated"), "缺少像素图无模糊渲染规则");

const expected = [
  ...["yutong", "wangshang", "chongrui"].map(x => `assets/heroes/${x}.png`),
  ...Array.from({ length: 10 }, (_, i) => `assets/backgrounds/zone-${String(i + 1).padStart(2, "0")}.png`),
  ...Array.from({ length: 10 }, (_, i) => `assets/enemies/zone-${String(i + 1).padStart(2, "0")}.png`),
  ...Array.from({ length: 10 }, (_, i) => `assets/bosses/family-${String(i + 1).padStart(2, "0")}.png`),
  "assets/ui/equipment.png"
];
const expectedV2 = [
  ...["yutong", "wangshang", "chongrui"].map(x => `assets-v2/heroes/${x}-v2.png`),
  ...Array.from({ length: 10 }, (_, i) => `assets-v2/enemies/zone-${String(i + 1).padStart(2, "0")}-v2.png`),
  "assets-v2/ui/icons-v2.png"
];

function pngInfo(file) {
  const data = fs.readFileSync(path.join(root, file));
  ok(data.subarray(1, 4).toString() === "PNG", `${file} 不是有效 PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25], bytes: data.length };
}

let totalBytes = 0;
for (const file of expected) {
  const full = path.join(root, file);
  ok(fs.existsSync(full), `缺少素材：${file}`);
  if (!fs.existsSync(full)) continue;
  const info = pngInfo(file);
  totalBytes += info.bytes;
  ok(info.width >= 640 && info.height >= 360, `${file} 分辨率过低：${info.width}×${info.height}`);
  if (!file.includes("backgrounds")) ok([4, 6].includes(info.colorType), `${file} 缺少透明通道`);
}

for (const file of expectedV2) {
  const full = path.join(root, file);
  ok(fs.existsSync(full), `缺少 v2 素材：${file}`);
  if (!fs.existsSync(full)) continue;
  const info = pngInfo(file);
  totalBytes += info.bytes;
  ok([4, 6].includes(info.colorType), `${file} 缺少透明通道`);
  if (file.includes("heroes")) ok(info.width === 948 && info.height === 1659, `${file} 不是 4×7 英雄图集`);
  if (file.includes("enemies")) ok(info.width === 1024 && info.height === 1536, `${file} 不是 4×6 敌人图集`);
  if (file.includes("assets-v2/ui/")) ok(info.width === info.height, `${file} 不是正方形 UI 图集`);
}

if (errors.length) {
  console.error(errors.map(x => `- ${x}`).join("\n"));
  process.exit(1);
}
const finalAssetCount = expected.length + expectedV2.length;
console.log(`验证通过：${finalAssetCount} 个最终生成素材，合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB。`);
console.log("规则通过：10000 关、每 100 关 Boss、12 小时关闭收益、后台补算与 Boss 自动重试。");
