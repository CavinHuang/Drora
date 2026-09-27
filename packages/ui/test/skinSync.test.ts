import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SKIN_PREFERENCE, SKIN_STORAGE_KEY } from "../src/skin/skinPreference.js";
import { createSkinPreferenceSync } from "../src/skin/skinSync.js";
import { SKIN_BROADCAST_CHANNEL } from "@drora/shared";

test("web skin sync stays in the browser profile and ignores the server broadcaster", async () => {
  const sent: unknown[] = [];
  let storageListener: ((event: StorageEvent) => void) | null = null;
  const received: unknown[] = [];
  const sync = createSkinPreferenceSync({
    mode: "web",
    broadcast: {
      send: async (message) => {
        sent.push(message);
      },
      onMessage: () => ({ dispose() {} }),
    },
    storageEvents: {
      addEventListener: (_name, listener) => {
        storageListener = listener;
      },
      removeEventListener: () => {},
    },
    onPreference: (preference) => received.push(preference),
  });
  sync.publish(DEFAULT_SKIN_PREFERENCE);
  assert.equal(sent.length, 0);
  storageListener?.({ key: "other", newValue: "{}" } as StorageEvent);
  assert.equal(received.length, 0);
  storageListener?.({
    key: SKIN_STORAGE_KEY,
    newValue: JSON.stringify({ ...DEFAULT_SKIN_PREFERENCE, presetId: "ocean" }),
  } as StorageEvent);
  assert.equal((received[0] as { presetId: string }).presetId, "ocean");
  sync.dispose();
});

test("desktop skin sync uses the app-local broadcast channel", async () => {
  const sent: unknown[] = [];
  let messageListener: ((message: { channel: string; payload: unknown }) => void) | null = null;
  const received: unknown[] = [];
  const sync = createSkinPreferenceSync({
    mode: "desktop",
    broadcast: {
      send: async (message) => {
        sent.push(message);
      },
      onMessage: (listener) => {
        messageListener = listener;
        return { dispose() {} };
      },
    },
    onPreference: (preference) => received.push(preference),
  });
  sync.publish(DEFAULT_SKIN_PREFERENCE);
  assert.deepEqual(sent, [{ channel: SKIN_BROADCAST_CHANNEL, payload: DEFAULT_SKIN_PREFERENCE }]);
  messageListener?.({ channel: SKIN_BROADCAST_CHANNEL, payload: DEFAULT_SKIN_PREFERENCE });
  assert.equal(received.length, 1);
  sync.dispose();
});
