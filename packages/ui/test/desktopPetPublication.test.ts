import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPetPresentation, IPlatformService } from "@drora/shared";
import {
  leaseDesktopPetPublication,
  mergeDesktopPetPresentations,
} from "../src/lib/desktopPetPublication.js";

function projection(identity: string, revision = 1): DesktopPetPresentation {
  return {
    mode: "working",
    activeCount: 1,
    attentionCount: 0,
    activities: [
      {
        target: {
          workspacePath: "/same/path",
          workspaceIdentity: identity,
          remoteSessionId: identity,
          sessionId: "same-session",
        },
        title: identity,
        mode: "working",
        revision,
      },
    ],
  };
}

test("background workspace leases coexist and withdrawing one never clears another", () => {
  const published: DesktopPetPresentation[] = [];
  const platform = {
    publishDesktopPet: (value: DesktopPetPresentation) => published.push(value),
  } as IPlatformService;
  const first = leaseDesktopPetPublication(platform);
  const second = leaseDesktopPetPublication(platform);
  first.update(projection("first"));
  second.update(projection("second"));
  assert.equal(published.at(-1)?.activities?.length, 2);
  first.release();
  assert.equal(published.at(-1)?.activities?.[0]?.target.workspaceIdentity, "second");
  first.update(projection("stale"));
  first.release();
  assert.equal(published.at(-1)?.activities?.length, 1);
  second.release();
  assert.equal(published.at(-1)?.mode, "idle");
});

test("one target is deduplicated by full identity/session and newest activity wins", () => {
  const result = mergeDesktopPetPresentations([
    projection("one", 1),
    projection("one", 2),
    projection("two", 1),
  ]);
  assert.equal(result.activities?.length, 2);
  assert.equal(result.activities?.[0]?.revision, 2);
});

test("publication leases are window/platform scoped", () => {
  const first: DesktopPetPresentation[] = [],
    second: DesktopPetPresentation[] = [];
  leaseDesktopPetPublication({
    publishDesktopPet: (value) => first.push(value),
  } as IPlatformService).update(projection("one"));
  leaseDesktopPetPublication({
    publishDesktopPet: (value) => second.push(value),
  } as IPlatformService).update(projection("two"));
  assert.equal(first[0]?.activities?.[0]?.title, "one");
  assert.equal(second[0]?.activities?.[0]?.title, "two");
});
