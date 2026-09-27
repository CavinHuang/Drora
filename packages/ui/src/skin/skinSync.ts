import { SKIN_BROADCAST_CHANNEL, SKIN_STORAGE_KEY } from "@drora/shared";
import type { BroadcastMessage } from "@drora/services";
import {
  isSkinPreferencePayload,
  normalizeSkinPreference,
  parseSkinPreference,
  type SkinPreference,
} from "./skinPreference.js";

export type SkinSyncMode = "desktop" | "web";

interface SkinBroadcastPort {
  send(message: BroadcastMessage): Promise<void>;
  onMessage(listener: (message: BroadcastMessage) => void): { dispose(): void };
}

interface SkinStorageEventPort {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
}

export function createSkinPreferenceSync(options: {
  mode: SkinSyncMode;
  broadcast: SkinBroadcastPort;
  storageEvents?: SkinStorageEventPort | null;
  onPreference: (preference: SkinPreference) => void;
}): { publish(preference: SkinPreference): Promise<void>; dispose(): void } {
  if (options.mode === "web") {
    const events: SkinStorageEventPort | null =
      options.storageEvents ??
      (typeof window === "undefined"
        ? null
        : {
            addEventListener: (_type, listener) => window.addEventListener("storage", listener),
            removeEventListener: (_type, listener) =>
              window.removeEventListener("storage", listener),
          });
    const onStorage = (event: StorageEvent) => {
      if (event.key === SKIN_STORAGE_KEY) {
        options.onPreference(parseSkinPreference(event.newValue));
      }
    };
    events?.addEventListener("storage", onStorage);
    return {
      async publish() {},
      dispose: () => events?.removeEventListener("storage", onStorage),
    };
  }

  const subscription = options.broadcast.onMessage((message) => {
    if (message.channel === SKIN_BROADCAST_CHANNEL && isSkinPreferencePayload(message.payload)) {
      options.onPreference(normalizeSkinPreference(message.payload));
    }
  });
  return {
    publish: (preference) =>
      options.broadcast.send({ channel: SKIN_BROADCAST_CHANNEL, payload: preference }),
    dispose: () => subscription.dispose(),
  };
}
