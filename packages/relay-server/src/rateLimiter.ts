// 注册限速：每 IP 滑动窗口计数（spec §6，默认 10 次/分钟/IP，超限 close 1013）。
/** 每 IP 滑动窗口限速（注册接口）。 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hitsByIp = new Map<string, number[]>();
  return {
    allow(ip: string, now = Date.now()): boolean {
      const hits = (hitsByIp.get(ip) ?? []).filter((ts) => now - ts < windowMs);
      if (hits.length >= limit) {
        hitsByIp.set(ip, hits);
        return false;
      }
      hits.push(now);
      hitsByIp.set(ip, hits);
      return true;
    },
  };
}
