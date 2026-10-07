// Drora Relay Server · 设备凭据持久层：device_sid ↔ pass_hash（官方语义：注册一次、
// 跨连接鉴权）。存储适配器接口化——默认原子写 JSON 文件（设备表极小），可换 DB。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeviceRecord } from "./protocol.js";
import { makeDeviceSid } from "./protocol.js";

export interface DeviceRegistryStorage {
  load(): Promise<DeviceRecord[]>;
  save(records: DeviceRecord[]): Promise<void>;
}

export function createFileDeviceRegistryStorage(filePath: string): DeviceRegistryStorage {
  return {
    async load() {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as DeviceRecord[]) : [];
      } catch {
        return [];
      }
    },
    async save(records) {
      await mkdir(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      await rename(tmp, filePath);
    },
  };
}

export interface DeviceRegistry {
  /** 注册（旋转语义：同 device_mid 重复注册生成新 sid；超限淘汰最旧）。 */
  register(params: { deviceMid: string; passHash: string; now?: number }): Promise<DeviceRecord>;
  /** 懒加载对读路径同样生效（首次查询触发文件读取）。 */
  getBySid(deviceSid: string): Promise<DeviceRecord | undefined>;
  touch(deviceSid: string, now: number): Promise<void>;
  /** 供停机时刷新 last_seen 等收尾使用。 */
  flush(): Promise<void>;
}

export function createDeviceRegistry(params: {
  storage: DeviceRegistryStorage;
  maxLiveSidsPerDeviceMid?: number;
}): DeviceRegistry {
  const maxLive = params.maxLiveSidsPerDeviceMid ?? 8;
  let records: DeviceRecord[] = [];
  let loaded = false;
  let loading: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loading ??= params.storage.load().then((loaded_records) => {
      records = loaded_records;
      loaded = true;
    });
    await loading;
  }

  async function persist(): Promise<void> {
    await params.storage.save(records);
  }

  return {
    async register({ deviceMid, passHash, now = Date.now() }) {
      await ensureLoaded();
      const sameMid = records
        .filter((record) => record.deviceMid === deviceMid)
        .sort((a, b) => a.createdAt - b.createdAt);
      while (sameMid.length >= maxLive) {
        const oldest = sameMid.shift();
        if (!oldest) break;
        records = records.filter((record) => record !== oldest);
      }
      const record: DeviceRecord = {
        deviceSid: makeDeviceSid(),
        deviceMid,
        passHash,
        createdAt: now,
        lastSeenAt: now,
      };
      records.push(record);
      await persist();
      return record;
    },
    async getBySid(deviceSid: string) {
      await ensureLoaded();
      return records.find((record) => record.deviceSid === deviceSid);
    },
    async touch(deviceSid: string, now: number) {
      await ensureLoaded();
      const record = records.find((entry) => entry.deviceSid === deviceSid);
      if (record) record.lastSeenAt = now;
    },
    async flush() {
      await persist();
    },
  };
}
