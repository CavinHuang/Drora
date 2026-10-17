// 从 assets/desktop-pet-catgirls/（v5 猫娘 WEBP 图集）生成 desktopPetCatgirlArtwork.ts：
// 每角色 11 动作 × 8 帧重排为单张 8 列图集（96×192 显示格），以 data URL 内嵌。
// 运行链与 violet-cat 管线一致（见 desktopPetMotionCss / desktopPetContent）。
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const assetsUrl = "D:/workspace/projects/Drora/packages/desktop/assets/desktop-pet-catgirls/";
const modulePath = fileURLToPath(
  new URL("../src/main/desktopPetCatgirlArtwork.ts", import.meta.url),
);
const CELL_WIDTH = 96;
const CELL_HEIGHT = 192; // 帧原始 320×640（1:2），×0.3 → 96×192
const COLUMNS = 8;

const manifest = JSON.parse(await readFile(join(assetsUrl, "manifest.json"), "utf8"));
const NAME_EN = { noir: "Noir", snow: "Snow", ginger: "Ginger" };
const characters = [];
for (const character of manifest.characters) {
  const rows = [];
  for (const [row, action] of character.actions.entries()) {
    if (action.frameCount < 2 || action.frameCount > COLUMNS) {
      throw new Error(`Invalid frame count for ${character.id}/${action.id}`);
    }
    rows.push({ ...action, row });
  }
  characters.push({
    id: character.id,
    name: character.name,
    nameEn: NAME_EN[character.id] ?? character.id,
    actions: rows,
    // 接口 DesktopPetCatgirlCharacter 声明这三个字段必填（测试按接口断言
    // columns/cellWidth/cellHeight）；此前生成器漏发，生成物违反自身类型
    // （desktop 的 src/main 不在 root typecheck 范围，编译期不可见）。
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    columns: COLUMNS,
  });
}

for (const character of characters) {
  const composite = [];
  for (const action of character.actions) {
    const source = await readFile(join(assetsUrl, action.atlas));
    // 修复原因：此前把整张源图集（4×2 帧，1280×1280）一次性缩放成 768×N 长条，
    // 再把它按 8 个偏移重复 composite——产物每格是重叠压扁的拼贴（半人/双影人）。
    // 正确做法：逐帧从源图集按 manifest 网格切出 320×640，单帧缩放到 96×192 再落格。
    for (let frame = 0; frame < action.frameCount; frame += 1) {
      const sourceColumn = frame % manifest.columns;
      const sourceRow = Math.floor(frame / manifest.columns);
      const frameCell = await sharp(source)
        .extract({
          left: sourceColumn * manifest.frameWidth,
          top: sourceRow * manifest.frameHeight,
          width: manifest.frameWidth,
          height: manifest.frameHeight,
        })
        .resize(CELL_WIDTH, CELL_HEIGHT, { fit: "fill" })
        .png()
        .toBuffer();
      const column = frame % COLUMNS;
      const row = Math.floor(frame / COLUMNS);
      composite.push({
        input: frameCell,
        left: column * CELL_WIDTH,
        top: action.row * CELL_HEIGHT + row * CELL_HEIGHT,
      });
    }
  }
  const atlasHeight = CELL_HEIGHT * character.actions.length;
  const webp = await sharp({
    create: {
      width: CELL_WIDTH * COLUMNS,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .webp({ quality: 85, alphaQuality: 90 })
    .toBuffer();
  character.dataUrl = `data:image/webp;base64,${webp.toString("base64")}`;
  console.log(`${character.id}: atlas ${(webp.length / 1024).toFixed(0)}KB, ${character.actions.length} actions`);
}

const body = `/** Generated from assets/desktop-pet-catgirls/manifest.json by scripts/generate-desktop-pet-catgirl-art.mjs. */
/** 单图集所有者：每角色一张 8 列 WEBP 图集，动作占一行；播放状态仍由 CSS 游标持有。 */
export interface DesktopPetCatgirlAction {
  id: string;
  label: string;
  fps: number;
  loop: boolean;
  row: number;
  frameCount: number;
}

export interface DesktopPetCatgirlCharacter {
  id: string;
  name: string;
  dataUrl: string;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  actions: DesktopPetCatgirlAction[];
}

export const desktopPetCatgirlCellWidth = ${CELL_WIDTH};
export const desktopPetCatgirlCellHeight = ${CELL_HEIGHT};
export const desktopPetCatgirlColumns = ${COLUMNS};

export const desktopPetCatgirlCharacters: DesktopPetCatgirlCharacter[] = ${JSON.stringify(
   characters,
   null,
   2,
 )};
`;
await writeFile(modulePath, body);
console.log(`written: ${modulePath}`);
