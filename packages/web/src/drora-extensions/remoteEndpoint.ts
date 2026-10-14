/** 同源部署适配；返回 undefined 时保留官方端点解析。 */
export function resolveHostedRemoteRelayUrl(
  location: Pick<Location, "pathname" | "protocol" | "host">,
): string | undefined {
  if (!/^\/remote\/v4(?:\/|$)/.test(location.pathname)) return undefined;
  if (location.protocol !== "http:" && location.protocol !== "https:") return undefined;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}
