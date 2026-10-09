// 把 codex worktree 产出的猫娘 v5 图集（PNG）转 WEBP 收进仓内资产目录。
// 只搬运行时需要的 11 动作 atlas + manifest；QA/预览/提示词留在原 worktree。
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SRC = process.argv[2];
const OUT = "D:/workspace/projects/Drora/packages/desktop/assets/desktop-pet-catgirls/";
const CHARACTERS = ["noir", "snow", "ginger"];

if (!SRC) throw new Error("usage: node convert-catgirl-assets.mjs <animations-v5-dir>");
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
mkdirSync(OUT, { recursive: true });
// manifest 内的 frames[].png 明细不需要入库（每动作 8 帧就是 atlas 的 4×2 格），
// 改写为轻量版只留动作参数，避免 1522 项文件名清单进仓。
const lite = {
  version: manifest.version,
  frameWidth: manifest.frameWidth,
  frameHeight: manifest.frameHeight,
  columns: manifest.columns,
  rows: manifest.rows,
  motionRevision: manifest.motionRevision,
  characters: manifest.characters.map((c) => ({
    id: c.id,
    name: c.name,
    actions: c.actions.map((a) => ({
      id: a.id,
      label: a.label,
      fps: a.fps,
      loop: a.loop,
      atlas: `${a.atlas.replace(/-atlas\.png$/, "-atlas.webp")}`,
      frameCount: a.frames.length,
    })),
  })),
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(lite, null, 2) + "\n");

let bytes = 0;
for (const char of lite.characters) {
  mkdirSync(join(OUT, char.id), { recursive: true });
  for (const action of char.actions) {
    const src = join(SRC, action.atlas.replace("-atlas.webp", "-atlas.png"));
    const dst = join(OUT, char.id, `${action.id}-atlas.webp`);
    if (!existsSync(src)) throw new Error(`missing source atlas: ${src}`);
    const buf = await sharp(src).webp({ quality: 85, alphaQuality: 90 }).toBuffer();
    writeFileSync(dst, buf);
    bytes += buf.length;
    console.log(`${char.id}/${action.id}: ${(buf.length / 1024).toFixed(0)}KB`);
  }
}
console.log(`total webp: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
