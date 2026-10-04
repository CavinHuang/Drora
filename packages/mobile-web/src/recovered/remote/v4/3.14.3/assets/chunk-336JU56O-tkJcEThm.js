// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "assets/dagre-KV5264BT-DejiSUVG.js",
      "assets/chunk-U2HBQHQK-CI5amqdB.js",
      "assets/src-BBFd38IP.js",
      "assets/chunk-Bj-mKKzh.js",
      "assets/string-BiG5pQoQ.js",
      "assets/chunk-5PVQY5BW-DWFSA3XD.js",
      "assets/dist-HM_ueeSG.js",
      "assets/step-DQ5jOZYc.js",
      "assets/linearClosed-CPjgBXXV.js",
      "assets/catmullRom-BBL7qS9P.js",
      "assets/math-khhgsiMe.js",
      "assets/chunk-ICPOFSXX-DxCSEkoa.js",
      "assets/preload-helper-DodngMS5.js",
      "assets/identity-CjwiSDWr.js",
      "assets/dagre-C_0gqv0B.js",
      "assets/graphlib-BSJWUyrs.js",
      "assets/isEmpty-BxF4yQAO.js",
      "assets/reduce-om2mLLJK.js",
      "assets/flatten-Dg861sYI.js",
      "assets/clone-KBF5hqbx.js",
      "assets/chunk-5FUZZQ4R-DpeQhTf9.js",
      "assets/chunk-X2U36JSP-DY2Te1W5.js",
      "assets/chunk-ZZ45TVLE-BJqQmKlF.js",
      "assets/rough.esm-DC3PnoLi.js",
      "assets/chunk-BSJP7CBP-ovkNe3J_.js",
      "assets/chunk-ENJZ2VHE-o8k5E-At.js",
      "assets/line-D6vmnEQN.js",
      "assets/array-CZO-YzxN.js",
      "assets/path-uUrcE9nt.js",
      "assets/path-Nr114YUd.js",
      "assets/cose-bilkent-S5V4N54A-CP2znpvn.js",
      "assets/cytoscape.esm-DrA8Ev2-.js",
    ]),
) => i.map((i) => d[i]);
import { t as e } from "./preload-helper-DodngMS5.js";
import { i as t, r as n } from "./src-BBFd38IP.js";
import { s as r, y as i } from "./chunk-ICPOFSXX-DxCSEkoa.js";
import { u as a } from "./chunk-5PVQY5BW-DWFSA3XD.js";
import { a as o, i as s, s as c } from "./chunk-5FUZZQ4R-DpeQhTf9.js";
import { a as l, i as u, n as d, r as f } from "./chunk-ENJZ2VHE-o8k5E-At.js";
var p = {
    common: r,
    getConfig: i,
    insertCluster: s,
    insertEdge: d,
    insertEdgeLabel: f,
    insertMarkers: u,
    insertNode: o,
    interpolateToCurve: a,
    labelHelper: c,
    log: t,
    positionEdgeLabel: l,
  },
  m = {},
  h = n((e) => {
    for (let t of e) m[t.name] = t;
  }, `registerLayoutLoaders`);
n(() => {
  h([
    {
      name: `dagre`,
      loader: n(
        async () =>
          await e(
            () => import(`./dagre-KV5264BT-DejiSUVG.js`),
            __vite__mapDeps([
              0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
              24, 25, 26, 27, 28, 29,
            ]),
          ),
        `loader`,
      ),
    },
    ...[
      {
        name: `cose-bilkent`,
        loader: n(
          async () =>
            await e(
              () => import(`./cose-bilkent-S5V4N54A-CP2znpvn.js`),
              __vite__mapDeps([30, 3, 31, 2, 4]),
            ),
          `loader`,
        ),
      },
    ],
  ]);
}, `registerDefaultLayoutLoaders`)();
var g = n(async (e, t) => {
    if (!(e.layoutAlgorithm in m)) throw Error(`Unknown layout algorithm: ${e.layoutAlgorithm}`);
    if (e.diagramId)
      for (let t of e.nodes) {
        let n = t.domId || t.id;
        t.domId = `${e.diagramId}-${n}`;
      }
    let n = m[e.layoutAlgorithm],
      r = await n.loader(),
      { theme: i, themeVariables: a } = e.config,
      { useGradient: o, gradientStart: s, gradientStop: c } = a,
      l = t.attr(`id`);
    if (
      (t
        .append(`defs`)
        .append(`filter`)
        .attr(`id`, `${l}-drop-shadow`)
        .attr(`height`, `130%`)
        .attr(`width`, `130%`)
        .append(`feDropShadow`)
        .attr(`dx`, `4`)
        .attr(`dy`, `4`)
        .attr(`stdDeviation`, 0)
        .attr(`flood-opacity`, `0.06`)
        .attr(`flood-color`, `${i?.includes(`dark`) ? `#FFFFFF` : `#000000`}`),
      t
        .append(`defs`)
        .append(`filter`)
        .attr(`id`, `${l}-drop-shadow-small`)
        .attr(`height`, `150%`)
        .attr(`width`, `150%`)
        .append(`feDropShadow`)
        .attr(`dx`, `2`)
        .attr(`dy`, `2`)
        .attr(`stdDeviation`, 0)
        .attr(`flood-opacity`, `0.06`)
        .attr(`flood-color`, `${i?.includes(`dark`) ? `#FFFFFF` : `#000000`}`),
      o)
    ) {
      let e = t
        .append(`linearGradient`)
        .attr(`id`, t.attr(`id`) + `-gradient`)
        .attr(`gradientUnits`, `objectBoundingBox`)
        .attr(`x1`, `0%`)
        .attr(`y1`, `0%`)
        .attr(`x2`, `100%`)
        .attr(`y2`, `0%`);
      (e.append(`svg:stop`).attr(`offset`, `0%`).attr(`stop-color`, s).attr(`stop-opacity`, 1),
        e.append(`svg:stop`).attr(`offset`, `100%`).attr(`stop-color`, c).attr(`stop-opacity`, 1));
    }
    return r.render(e, t, p, { algorithm: n.algorithm });
  }, `render`),
  _ = n((e = ``, { fallback: n = `dagre` } = {}) => {
    if (e in m) return e;
    if (n in m)
      return (t.warn(`Layout algorithm ${e} is not registered. Using ${n} as fallback.`), n);
    throw Error(`Both layout algorithms ${e} and ${n} are not registered.`);
  }, `getRegisteredLayoutAlgorithm`);
export { h as n, g as r, _ as t };
