import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";
// CUA broker socket 的 wire 键是还原区冻结的 ZCODE_ 前缀值，此前此处播种/探测 DRORA_
// 前缀字面量：sanitize/capture 链读的是冻结键 —— socket 未被剔除（import 期可见）、
// token 未被捕获恢复（main 期不可见），两断言双双反向。改用 @drora/shared 导出的
// 常量做单一出处（台账 32③ mcp-tool-bridge 同款先例）；本测试以 tsx 运行，可直接
// 解析 shared 的 TS 导出。
import {
  DRORA_CUA_BROKER_SOCKET_ENV_KEY,
  DRORA_CUA_BROKER_TOKEN_ENV_KEY,
} from "@drora/shared";
import {
  createZodDedupePlugin,
  readZodBuildVersion,
  resolveBuildAliases,
  resolveBuildExternal,
} from "../scripts/build.mjs";

const execFileAsync = promisify(execFile);
const cliRoot = resolve(import.meta.dirname, "..");
const forbiddenEvaluation = "AGENT_ENTRY_EVALUATED";
const processTimeoutMs = 10_000;

for (const minify of [false, true]) {
  test(`plugin host avoids Agent initialization in ${minify ? "desktop" : "Node"} bundles`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "drora-plugin-entry-"));
    const outfile = join(directory, "drora.cjs");
    const serverPath = join(directory, "server.mjs");
    const blockedModules = new Set([
      resolve(cliRoot, "src/run.ts"),
      resolve(cliRoot, "src/provider-runtime-env.ts"),
      resolve(cliRoot, "../core/dist/runtime.js"),
      resolve(cliRoot, "../contracts/dist/index.js"),
      resolve(cliRoot, "../../../../packages/shared/src/index.ts"),
    ]);

    try {
      await writeFile(
        serverPath,
        `const socketVisibleAtImport = process.env[${JSON.stringify(DRORA_CUA_BROKER_SOCKET_ENV_KEY)}] !== undefined;
export async function main() {
  process.stdout.write(JSON.stringify({
    args: process.argv.slice(2),
    nodeEnvRemoved: process.env.NODE_ENV === undefined,
    socketVisibleAtImport,
    socketVisibleAtMain: process.env[${JSON.stringify(DRORA_CUA_BROKER_SOCKET_ENV_KEY)}] !== undefined,
    tokenVisibleAtMain: process.env[${JSON.stringify(DRORA_CUA_BROKER_TOKEN_ENV_KEY)}] !== undefined,
  }));
}`,
      );
      await build({
        alias: resolveBuildAliases(),
        bundle: true,
        entryPoints: [join(cliRoot, "src/main.ts")],
        external: resolveBuildExternal(),
        format: "cjs",
        keepNames: minify,
        minify,
        metafile: true,
        outfile,
        platform: "node",
        target: "node22",
        plugins: [
          createZodDedupePlugin({ expectedV4Version: await readZodBuildVersion() }),
          {
            name: "reject-agent-initialization",
            setup(builder) {
              builder.onLoad({ filter: /\.[jt]s$/ }, async ({ path }) => {
                if (!blockedModules.has(path)) return undefined;
                // 回归要挡住模块求值，而非只看包大小；构建仍保留普通 CLI 所需代码。
                return {
                  contents: `throw new Error(${JSON.stringify(forbiddenEvaluation)});\n${await readFile(path, "utf8")}`,
                  loader: path.endsWith(".ts") ? "ts" : "js",
                };
              });
            },
          },
        ],
      });

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [outfile, "__drora-plugin-host", serverPath, "--prompt", "plugin argument"],
        { env: { ...process.env, NODE_ENV: "untrusted" }, timeout: processTimeoutMs },
      );
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout), {
        args: ["--prompt", "plugin argument"],
        nodeEnvRemoved: true,
        socketVisibleAtImport: false,
        socketVisibleAtMain: false,
        tokenVisibleAtMain: false,
      });

      const brokerSocket = join(directory, "broker.sock");
      const authorizedEnv = {
        ...process.env,
        NODE_ENV: "untrusted",
        DRORA_PLUGIN_ID: "computer-use@drora-plugins-official",
        [DRORA_CUA_BROKER_SOCKET_ENV_KEY]: brokerSocket,
        [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: "test-scoped-token",
        DRORA_CUA_PLUGIN_AUTHORITY: "test-official-authority",
        // broker 已改身份模式（Helper 按对端代码签名裁决连接），凭据组只剩 socket +
        // pluginAuthority；captured 凭据只允许启动 shared node_repl 宿主，由这个标记声明。
        DRORA_CUA_NODE_REPL_HOST: "1",
      };
      const authorized = await execFileAsync(
        process.execPath,
        [outfile, "__drora-plugin-host", serverPath, "--permission-broker-socket", brokerSocket],
        { env: authorizedEnv, timeout: processTimeoutMs },
      );
      assert.equal(authorized.stderr, "");
      assert.deepEqual(JSON.parse(authorized.stdout), {
        args: ["--permission-broker-socket", brokerSocket],
        nodeEnvRemoved: true,
        // socket 被 sanitize 收进 capture，插件模块求值时读不到；只有 plugin host 在
        // 确认是可信 node_repl 宿主后才恢复到 env，供 broker bridge 读取。
        socketVisibleAtImport: false,
        socketVisibleAtMain: true,
        // 冻结 SDK 需要 scoped token，仅可信宿主运行期间可见。
        tokenVisibleAtMain: true,
      });

      // 非 node_repl 宿主必须在插件 import 前被拒绝，不能因入口提前分流绕过产品鉴权。
      // 旧契约比对 argv 上的 socket 值，身份模式下改为要求宿主标记；拦截时机的要求不变。
      await writeFile(serverPath, 'throw new Error("UNAUTHORIZED_PLUGIN_IMPORTED");');
      const { DRORA_CUA_NODE_REPL_HOST: _hostMarker, ...unauthorizedEnv } = authorizedEnv;
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [outfile, "__drora-plugin-host", serverPath, "--permission-broker-socket", brokerSocket],
          { env: unauthorizedEnv, timeout: processTimeoutMs },
        ),
        (error) =>
          error.stdout === "" &&
          error.stderr.includes("Captured Drora CUA broker credentials may only launch") &&
          !error.stderr.includes("UNAUTHORIZED_PLUGIN_IMPORTED"),
      );

      // 证明探针实际生效：普通命令仍进入业务分支，触发被注入的求值错误。
      await assert.rejects(
        execFileAsync(process.execPath, [outfile, "--version"], { timeout: processTimeoutMs }),
        (error) => error.stderr.includes(forbiddenEvaluation),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}
