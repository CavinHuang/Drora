// 内嵌 LAN relay 宿主（自研层，specs/mobile-relay-server.md §12）：
// 桌面应用进程内启动自建 relay-server，「局域网连接」传输与云中继统一走 relay 协议，
// 手机页默认官方 3.14.3 快照（§33.7 用户裁定"页面主体=官方 remote 实现"后翻转，
// 官方字节优先于自研源码应用）；快照缺失时回退源码构建产物，仅本地包不存在时
// 启用内建代理 cache→fetch 官方源站。入口缺失时 302 → R2 自建页 /m/index.html。
// 旧 LAN 直连配对服务栈
// （desktopMobilePairingServer/Core/Restore，协议 v1 + 一次性令牌）已删除
// （specs/mobile-relay-server.md §12.4），其 LAN 地址挑选逻辑（pickLanAddress）
// 迁入本文件继续服务内嵌 relay 出码。
//
// 职责边界：本模块只管内嵌服务端生命周期（listen/stop/幂等）与凭据 origin 路由的
// 纯逻辑；relay 控制链（desktopMobileRelayControl）与装配（index.ts）不在此处。
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
  createRelayServer,
} from "@zcode/relay-server";
import { createServiceLogger } from "@zcode/services/node";

type HostLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

// 服务级日志（AGENTS.md 日志规范）：模块级单例，宿主生命周期与 LAN 地址诊断共用。
const serviceLog = createServiceLogger("mobile-lan-relay");

/**
 * §33.11 产物一致性（raw 优先修正）：本地 v4 页面根候选序（纯函数，单测覆盖三种
 * 部署形态）。序 = ①仓库 upstream（官方原始字节冻结件——recovered 的 JS 是可读化
 * 格式化版，非官方原始字节，§33.11 修正）→ ②安装态随包 `mobile-web-official`
 * （electron-builder 自 upstream/remote/v4 staging，同原始字节）→ ③随包
 * `mobile-web`（旧 dist 产物，存量安装兜底）→ ④仓库 recovered（可读化回退）→
 * ⑤仓库 dist（末位兜底）。
 */
export function buildMobileWebRootCandidates(resourcesPath?: string): string[] {
  const repoUpstreamRoot = fileURLToPath(new URL("../../../mobile-web/upstream/", import.meta.url));
  const repoRecoveredRoot = fileURLToPath(
    new URL("../../../mobile-web/src/recovered/", import.meta.url),
  );
  const repoSourceBuildRoot = fileURLToPath(new URL("../../../mobile-web/dist/", import.meta.url));
  return [
    repoUpstreamRoot,
    ...(resourcesPath
      ? [
          join(resourcesPath, "mobile-web-official"),
          join(resourcesPath, "mobile-web"),
        ]
      : []),
    repoRecoveredRoot,
    repoSourceBuildRoot,
  ];
}

/** 开发态优先仓库官方原始冻结件，安装态优先随包官方快照（§33.11）；无本地页时走资产代理。 */
export async function resolveLocalMobileWebRoot(): Promise<string | undefined> {
  for (const root of buildMobileWebRootCandidates(process.resourcesPath)) {
    try {
      await access(join(root, "remote", "v4", "index.html"));
      return root;
    } catch {
      // 此候选不存在时尝试下一个；没有本地页才允许走旧资产代理。
    }
  }
  return undefined;
}

/**
 * LAN 内嵌 relay 的稳定逻辑 origin（specs/mobile-relay-server.md §12.2）：
 * 端口每次启动随机（port:0），设备注册表 registry.json 才是身份域——凭据路由键
 * 不含端口，凭据跨应用重启有效；云端 origin 用 relayWsUrl 的 scheme+host+port
 * （官方与任意自建部署互不通用）。
 */
export const LAN_EMBEDDED_RELAY_ORIGIN = "ws://127.0.0.1";

/** 凭据文件名：mobile-relay-device-<sha8(origin)>.json（旧单文件不迁移不删除）。 */
export function credentialFileNameForOrigin(origin: string): string {
  const hash = createHash("sha256").update(origin).digest("hex").slice(0, 8);
  return `mobile-relay-device-${hash}.json`;
}

/** 云端凭据路由键：relayWsUrl 的 origin；解析失败回落完整 URL（仍可隔离）。 */
export function resolveCloudRelayOrigin(relayWsUrl: string): string {
  try {
    return new URL(relayWsUrl).origin;
  } catch {
    return relayWsUrl;
  }
}

export interface DesktopMobileLanRelayHost {
  /** 确保内嵌 relay 已监听（幂等；已运行直接返回当前端口）。 */
  ensureStarted(): Promise<{ port: number }>;
  /** 停止内嵌 relay（幂等；未运行直接返回）。 */
  stop(): Promise<void>;
  isRunning(): boolean;
  /** 当前监听端口；未运行为 null。 */
  currentPort(): number | null;
}

export function createDesktopMobileLanRelayHost(deps: {
  logger: HostLogger;
  /** 设备注册表落盘路径；测试注入临时目录，生产缺省 ~/.zcode/v2/mobile-relay-lan/。 */
  registryFilePath?: string;
  /** 监听地址；缺省 0.0.0.0（手机须经局域网访问 WS 入口）。 */
  host?: string;
}): DesktopMobileLanRelayHost {
  // relay-server 的 log 面只认 {info, warn}，这里适配 traceId 参数形态。
  const relayLog = {
    info: (...args: unknown[]) => serviceLog.info(undefined, ...args),
    warn: (...args: unknown[]) => serviceLog.warn(undefined, ...args),
  };
  const registryFilePath =
    deps.registryFilePath ?? join(homedir(), ".zcode", "v2", "mobile-relay-lan", "registry.json");
  const listenHost = deps.host ?? "0.0.0.0";
  type RunningRelayServer = {
    listen(): Promise<number>;
    close(): Promise<void>;
  };
  let server: RunningRelayServer | null = null;
  let port: number | null = null;
  // 并发 ensureStarted 合流到同一次启动（弹层自动开启与恢复链路可能同时到达）。
  let starting: Promise<{ port: number }> | null = null;

  return {
    ensureStarted(): Promise<{ port: number }> {
      if (server && port !== null) return Promise.resolve({ port });
      starting ??= (async () => {
        const mobileRoot = await resolveLocalMobileWebRoot();
        const registry = createDeviceRegistry({
          storage: createFileDeviceRegistryStorage(registryFilePath),
        });
        const created = createRelayServer({
          registry,
          port: 0,
          host: listenHost,
          mobileRoot,
          // 自带页面时禁用官方代理，保证 LAN 可离线且不向 z.ai 请求资产。
          remoteAssets: mobileRoot
            ? undefined
            : { cacheDir: join(dirname(registryFilePath), "remote-assets") },
          log: relayLog,
        });
        try {
          const actualPort = await created.listen();
          server = created;
          port = actualPort;
          deps.logger.info("[mobile-lan-relay] 内嵌 relay 已监听", {
            host: listenHost,
            port: actualPort,
            registryFilePath,
          });
          return { port: actualPort };
        } catch (error) {
          // 启动失败不留半开实例，允许下次重试。
          starting = null;
          deps.logger.warn("[mobile-lan-relay] 内嵌 relay 启动失败", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      })();
      return starting;
    },
    async stop(): Promise<void> {
      const current = server;
      server = null;
      starting = null;
      port = null;
      if (!current) return;
      try {
        await current.close();
        deps.logger.info("[mobile-lan-relay] 内嵌 relay 已停止");
      } catch (error) {
        deps.logger.warn("[mobile-lan-relay] 内嵌 relay 停止失败（忽略）", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    isRunning: () => server !== null,
    currentPort: () => port,
  };
}

/**
 * LAN 传输的二维码页地址（specs/mobile-relay-server.md §12.1/§12.9）：手机必须经
 * 局域网 IPv4 访问内嵌 relay；找不到可用地址时抛错（环回地址对手机不可达，出码
 * 必然连不上）。页地址为本地托管 v4 页面（/remote/v4，§12.5-§12.8 双栈对齐结论的
 * 产品化）——本地入口缺失时该入口 302 回退 R2 极简页（/m/index.html，保留 QR
 * 查询参数），故无需客户端侧探测。WS 入口同理经 lanIp 可达（服务端绑 0.0.0.0）。
 */
export function buildLanRemotePageUrl(params: { port: number }): string {
  const lan = pickLanAddress();
  if (!lan) {
    throw new Error("未找到可用的局域网 IPv4 地址，无法生成手机可访问的二维码（请检查网络连接）");
  }
  serviceLog.info(undefined, "[mobile-lan-relay] LAN 地址已选定", {
    address: lan.address,
    interfaceName: lan.interfaceName,
  });
  return `http://${lan.address}:${params.port}/remote/v4`;
}

export interface LanAddressResult {
  address: string;
  interfaceName: string;
}

/** 放宽 Node 的 NetworkInterfaceInfo：测试可传入纯结构对象，family 用宽松 string。 */
type LanInterfaces = Record<
  string,
  Array<{ address: string; family: string; internal: boolean }> | undefined
>;

/**
 * 从本机网卡挑一个可供手机访问的 IPv4 地址（自旧 desktopMobilePairingCore 迁入，
 * 逻辑不变）。优先 192.168/10. 段的物理网段，回退任意非内环 IPv4；找不到返回
 * null（UI 提示）。排除虚拟网卡常见命名（vEthernet/Docker/WSL 等），减少扫出一个
 * 连不上的地址。
 */
export function pickLanAddress(
  interfaces: LanInterfaces = networkInterfaces(),
): LanAddressResult | null {
  const candidates: Array<LanAddressResult & { priority: number }> = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    if (/vethernet|docker|wsl|vmware|virtualbox|loopback|tailscale/i.test(name)) continue;
    for (const address of addresses) {
      if (address.internal || address.family !== "IPv4") continue;
      const priority = address.address.startsWith("192.168.")
        ? 2
        : address.address.startsWith("10.")
          ? 1
          : 0;
      if (priority > 0) {
        candidates.push({ address: address.address, interfaceName: name, priority });
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  const best = candidates[0];
  if (best) {
    return { address: best.address, interfaceName: best.interfaceName };
  }
  // 回退：任意非内环 IPv4（含 172.16-31 段）。
  for (const addresses of Object.values(interfaces)) {
    const fallback = addresses?.find((a) => !a.internal && a.family === "IPv4");
    if (fallback) {
      return { address: fallback.address, interfaceName: "" };
    }
  }
  return null;
}
