"""构建第三版独立帧素材，并生成可视化验收总览。"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
V3 = ROOT / "assets-v3"
HERO_ACTIONS = ["idle", "move", "attack", "skill", "ultimate", "hit", "down"]


def isolate_subject(frame: Image.Image) -> Image.Image:
    """仅保留最大连通主体，消除相邻格泄漏的武器和残肢。"""
    array = np.array(frame.convert("RGBA"))
    binary = (array[:, :, 3] > 12).astype(np.uint8)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    if count < 2:
        raise RuntimeError("素材格中没有检测到主体")
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == main).astype(np.uint8), np.ones((5, 5), np.uint8))
    array[:, :, 3] = (array[:, :, 3] * (keep > 0)).astype(np.uint8)
    return Image.fromarray(array)


def subject_crop(frame: Image.Image, isolate: bool = False) -> Image.Image:
    # 英雄与普通敌人已经处于独立格内，必须保留法杖、披风和粒子等非连通部分。
    # 只有生成式 Boss 源图需要提取最大主体，以剔除跨格污染。
    if isolate:
        frame = isolate_subject(frame)
    alpha = np.array(frame.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("主体透明化后为空")
    return frame.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def normalize_sequence(frames: list[Image.Image], size: int, margin: int, baseline: int, isolate: bool = False) -> list[Image.Image]:
    """同一动作序列共用缩放比例，防止动画播放时尺寸跳动。"""
    subjects = [subject_crop(frame, isolate=isolate) for frame in frames]
    return normalize_subjects(subjects, size, margin, baseline)


def normalize_subjects(subjects: list[Image.Image], size: int, margin: int, baseline: int) -> list[Image.Image]:
    max_width = max(subject.width for subject in subjects)
    max_height = max(subject.height for subject in subjects)
    scale = min((size - margin * 2) / max_width, (baseline - margin) / max_height)
    output = []
    for subject in subjects:
        target = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
        subject = subject.resize(target, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(subject, ((size - target[0]) // 2, baseline - target[1]))
        output.append(canvas)
    return output


def extract_subject_grid(source: Image.Image, rows: int, cols: int) -> list[list[Image.Image]]:
    """按连通主体的视觉中心重建网格，允许角色越过原始格线。"""
    array = np.array(source.convert("RGBA"))
    binary = (array[:, :, 3] > 12).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
    wanted = rows * cols
    component_ids = sorted(range(1, count), key=lambda index: stats[index, cv2.CC_STAT_AREA], reverse=True)[:wanted]
    if len(component_ids) != wanted:
        raise RuntimeError(f"主体数量不足：期望 {wanted}，实际 {len(component_ids)}")
    component_ids.sort(key=lambda index: centroids[index][1])
    grid = []
    for row in range(rows):
        row_ids = component_ids[row * cols:(row + 1) * cols]
        row_ids.sort(key=lambda index: centroids[index][0])
        subjects = []
        for component_id in row_ids:
            x, y, width, height, _ = stats[component_id]
            crop = array[y:y + height, x:x + width].copy()
            mask = labels[y:y + height, x:x + width] == component_id
            crop[:, :, 3] = (crop[:, :, 3] * mask).astype(np.uint8)
            subjects.append(Image.fromarray(crop))
        grid.append(subjects)
    return grid


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # method=4 在保持无损的同时显著缩短 424 帧的重复构建时间。
    image.save(path, "WEBP", lossless=True, method=4)


def build_heroes() -> None:
    for hero in ["yutong", "wangshang", "chongrui"]:
        source = Image.open(ROOT / "assets-v2" / "heroes" / f"{hero}-v2.png").convert("RGBA")
        grid = extract_subject_grid(source, 7, 4)
        for row, action in enumerate(HERO_ACTIONS):
            for index, frame in enumerate(normalize_subjects(grid[row], 256, 22, 236), 1):
                save_webp(frame, V3 / "heroes" / hero / f"{action}-{index}.webp")


def build_enemies() -> None:
    for zone in range(1, 11):
        source = Image.open(ROOT / "assets-v2" / "enemies" / f"zone-{zone:02d}-v2.png").convert("RGBA")
        grid = extract_subject_grid(source, 6, 4)
        for enemy in range(3):
            for action_offset, action in enumerate(["idle", "attack"]):
                row = enemy * 2 + action_offset
                for index, frame in enumerate(normalize_subjects(grid[row], 256, 20, 236), 1):
                    save_webp(frame, V3 / "enemies" / f"zone-{zone:02d}" / f"enemy-{enemy + 1:02d}-{action}-{index}.webp")


def build_bosses() -> None:
    for family in range(1, 11):
        source_path = V3 / "sources" / f"boss-family-{family:02d}-alpha.png"
        source = Image.open(source_path).convert("RGBA")
        output = V3 / "bosses" / f"family-{family:02d}"
        for index in range(10):
            col, row = index % 5, index // 5
            x0, x1 = round(col * source.width / 5), round((col + 1) * source.width / 5)
            y0, y1 = round(row * source.height / 2), round((row + 1) * source.height / 2)
            normalized = normalize_sequence([source.crop((x0, y0, x1, y1))], 512, 48, 464, isolate=True)[0]
            save_webp(normalized, output / f"form-{index + 1:02d}.webp")


def validate_frame(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    alpha = np.array(image.getchannel("A"))
    if alpha.min() != 0 or alpha.max() == 0:
        raise RuntimeError(f"透明通道异常：{path}")
    border = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    if border.max() != 0:
        raise RuntimeError(f"主体接触边界：{path}")


def build_boss_contact_sheet() -> None:
    tile = 132
    sheet = Image.new("RGB", (10 * tile, 10 * (tile + 18)), (10, 12, 17))
    draw = ImageDraw.Draw(sheet)
    for family in range(1, 11):
        for form in range(1, 11):
            path = V3 / "bosses" / f"family-{family:02d}" / f"form-{form:02d}.webp"
            image = Image.open(path).convert("RGBA")
            preview = Image.new("RGB", image.size, (24, 27, 34))
            preview.paste(image, mask=image.getchannel("A"))
            preview.thumbnail((tile - 8, tile - 8))
            x, y = (form - 1) * tile, (family - 1) * (tile + 18)
            sheet.paste(preview, (x + (tile - preview.width) // 2, y + 14 + (tile - preview.height) // 2))
            draw.text((x + 4, y + 2), f"F{family:02d}-{form:02d}", fill=(230, 210, 155))
    contact_dir = V3 / "contact-sheets"
    contact_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(contact_dir / "bosses-all.jpg", quality=92)


def main() -> None:
    build_heroes()
    build_enemies()
    build_bosses()
    frames = list((V3 / "heroes").rglob("*.webp")) + list((V3 / "enemies").rglob("*.webp")) + list((V3 / "bosses").rglob("*.webp"))
    for path in frames:
        validate_frame(path)
    build_boss_contact_sheet()
    print(f"v3 素材构建完成：{len(frames)} 个独立帧")


if __name__ == "__main__":
    main()
