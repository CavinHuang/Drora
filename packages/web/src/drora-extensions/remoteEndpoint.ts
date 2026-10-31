/**
 * 同源部署适配；返回 undefined 时保留官方端点解析。
 *
 * 同源路径必须是 relay-v2 网关的严格校验路径 `/api/v1/remote/ws2`
 * （`packages/relay-v2-server/src/ws.ts`，specs/relay-v2-server.md §8.7）。
 * 旧值 `/ws` 属已退役的 v1 自建 relay 路径，与 relay-v2 不兼容——自建页静态托管修好后
 * 仍无法配对的第二处断裂即在此。
 */
export function resolveHostedRemoteRelayUrl(
  location: Pick<Location, "pathname" | "protocol" | "host">,
): string | undefined {
  if (!/^\/remote\/v4(?:\/|$)/.test(location.pathname)) return undefined;
  if (location.protocol !== "http:" && location.protocol !== "https:") return undefined;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/remote/ws2`;
}
