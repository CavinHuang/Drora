import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const packageRoot = import.meta.dirname;
const serverOutputPath = resolve(packageRoot, "dist", "windows-helper.js");

await build({
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  entryPoints: [resolve(packageRoot, "src", "windows-helper.ts")],
  format: "esm",
  legalComments: "none",
  outfile: serverOutputPath,
  platform: "node",
  target: "node24",
});

await chmod(serverOutputPath, 0o755);
