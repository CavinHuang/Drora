// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "assets/info-OMHHGYJF-C2LPHKRD.js",
      "assets/chunk-K5T4RW27-DC1TZ8rA.js",
      "assets/chunk-Bj-mKKzh.js",
      "assets/isEmpty-BxF4yQAO.js",
      "assets/identity-CjwiSDWr.js",
      "assets/reduce-om2mLLJK.js",
      "assets/flatten-Dg861sYI.js",
      "assets/chunk-KGLVRYIC-BlUkStnu.js",
      "assets/packet-4T2RLAQJ-BWu13lzU.js",
      "assets/chunk-FOC6F5B3-BSwcMlQy.js",
      "assets/pie-ZZUOXDRM-CRayc3D2.js",
      "assets/chunk-AA7GKIK3-BEWhENbH.js",
      "assets/treeView-SZITEDCU-Cm-tz6mo.js",
      "assets/chunk-ORNJ4GCN-J1Rma2PW.js",
      "assets/architecture-YZFGNWBL-2cJ2f31N.js",
      "assets/chunk-7N4EOEYR-CABHnXF0.js",
      "assets/gitGraph-7Q5UKJZL-BqLqMxK5.js",
      "assets/chunk-67CJDMHE-BLh4TEla.js",
      "assets/radar-PYXPWWZC-DoY5sQfX.js",
      "assets/chunk-2KRD3SAO-BK03L_gZ.js",
      "assets/treemap-W4RFUUIX-DtOcWmbV.js",
      "assets/chunk-LIHQZDEY-C9QwlY--.js",
      "assets/wardley-RL74JXVD-VgxWR8Sd.js",
      "assets/chunk-CIAEETIT-icPNMEJX.js",
    ]),
) => i.map((i) => d[i]);
import { t as e } from "./preload-helper-DodngMS5.js";
import { m as t } from "./chunk-K5T4RW27-DC1TZ8rA.js";
import "./chunk-7N4EOEYR-CABHnXF0.js";
import "./chunk-67CJDMHE-BLh4TEla.js";
import "./chunk-KGLVRYIC-BlUkStnu.js";
import "./chunk-FOC6F5B3-BSwcMlQy.js";
import "./chunk-AA7GKIK3-BEWhENbH.js";
import "./chunk-2KRD3SAO-BK03L_gZ.js";
import "./chunk-ORNJ4GCN-J1Rma2PW.js";
import "./chunk-LIHQZDEY-C9QwlY--.js";
import "./chunk-CIAEETIT-icPNMEJX.js";
var n = {},
  r = {
    info: t(async () => {
      let { createInfoServices: t } = await e(
        async () => {
          let { createInfoServices: e } = await import(`./info-OMHHGYJF-C2LPHKRD.js`);
          return { createInfoServices: e };
        },
        __vite__mapDeps([0, 1, 2, 3, 4, 5, 6, 7]),
      );
      n.info = t().Info.parser.LangiumParser;
    }, `info`),
    packet: t(async () => {
      let { createPacketServices: t } = await e(
        async () => {
          let { createPacketServices: e } = await import(`./packet-4T2RLAQJ-BWu13lzU.js`);
          return { createPacketServices: e };
        },
        __vite__mapDeps([8, 1, 2, 3, 4, 5, 6, 9]),
      );
      n.packet = t().Packet.parser.LangiumParser;
    }, `packet`),
    pie: t(async () => {
      let { createPieServices: t } = await e(
        async () => {
          let { createPieServices: e } = await import(`./pie-ZZUOXDRM-CRayc3D2.js`);
          return { createPieServices: e };
        },
        __vite__mapDeps([10, 1, 2, 3, 4, 5, 6, 11]),
      );
      n.pie = t().Pie.parser.LangiumParser;
    }, `pie`),
    treeView: t(async () => {
      let { createTreeViewServices: t } = await e(
        async () => {
          let { createTreeViewServices: e } = await import(`./treeView-SZITEDCU-Cm-tz6mo.js`);
          return { createTreeViewServices: e };
        },
        __vite__mapDeps([12, 1, 2, 3, 4, 5, 6, 13]),
      );
      n.treeView = t().TreeView.parser.LangiumParser;
    }, `treeView`),
    architecture: t(async () => {
      let { createArchitectureServices: t } = await e(
        async () => {
          let { createArchitectureServices: e } = await import(
            `./architecture-YZFGNWBL-2cJ2f31N.js`
          );
          return { createArchitectureServices: e };
        },
        __vite__mapDeps([14, 1, 2, 3, 4, 5, 6, 15]),
      );
      n.architecture = t().Architecture.parser.LangiumParser;
    }, `architecture`),
    gitGraph: t(async () => {
      let { createGitGraphServices: t } = await e(
        async () => {
          let { createGitGraphServices: e } = await import(`./gitGraph-7Q5UKJZL-BqLqMxK5.js`);
          return { createGitGraphServices: e };
        },
        __vite__mapDeps([16, 1, 2, 3, 4, 5, 6, 17]),
      );
      n.gitGraph = t().GitGraph.parser.LangiumParser;
    }, `gitGraph`),
    radar: t(async () => {
      let { createRadarServices: t } = await e(
        async () => {
          let { createRadarServices: e } = await import(`./radar-PYXPWWZC-DoY5sQfX.js`);
          return { createRadarServices: e };
        },
        __vite__mapDeps([18, 1, 2, 3, 4, 5, 6, 19]),
      );
      n.radar = t().Radar.parser.LangiumParser;
    }, `radar`),
    treemap: t(async () => {
      let { createTreemapServices: t } = await e(
        async () => {
          let { createTreemapServices: e } = await import(`./treemap-W4RFUUIX-DtOcWmbV.js`);
          return { createTreemapServices: e };
        },
        __vite__mapDeps([20, 1, 2, 3, 4, 5, 6, 21]),
      );
      n.treemap = t().Treemap.parser.LangiumParser;
    }, `treemap`),
    wardley: t(async () => {
      let { createWardleyServices: t } = await e(
        async () => {
          let { createWardleyServices: e } = await import(`./wardley-RL74JXVD-VgxWR8Sd.js`);
          return { createWardleyServices: e };
        },
        __vite__mapDeps([22, 1, 2, 3, 4, 5, 6, 23]),
      );
      n.wardley = t().Wardley.parser.LangiumParser;
    }, `wardley`),
  };
async function i(e, t) {
  let i = r[e];
  if (!i) throw Error(`Unknown diagram type: ${e}`);
  n[e] || (await i());
  let o = n[e].parse(t);
  if (o.lexerErrors.length > 0 || o.parserErrors.length > 0) throw new a(o);
  return o.value;
}
t(i, `parse`);
var a = class extends Error {
  constructor(e) {
    let t = e.lexerErrors.map(
        (e) =>
          `Lexer error on line ${e.line !== void 0 && !isNaN(e.line) ? e.line : `?`}, column ${e.column !== void 0 && !isNaN(e.column) ? e.column : `?`}: ${e.message}`,
      ).join(`
`),
      n = e.parserErrors.map(
        (e) =>
          `Parse error on line ${e.token.startLine !== void 0 && !isNaN(e.token.startLine) ? e.token.startLine : `?`}, column ${e.token.startColumn !== void 0 && !isNaN(e.token.startColumn) ? e.token.startColumn : `?`}: ${e.message}`,
      ).join(`
`);
    (super(`Parsing failed: ${t} ${n}`), (this.result = e));
  }
  static {
    t(this, `MermaidParseError`);
  }
};
export { i as t };
