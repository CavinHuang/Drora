import { expect, it, vi } from "vitest";
import { applyDroraUpdateFeed } from "./updateFeed.js";

it("发行源装配保留默认 feed，并拒绝非 HTTP 地址", () => {
  const updater = { setFeedURL: vi.fn() };
  applyDroraUpdateFeed(updater);
  expect(updater.setFeedURL).not.toHaveBeenCalled();
  expect(() => applyDroraUpdateFeed(updater, "file:///tmp/update.yml")).toThrow();
  expect(updater.setFeedURL).not.toHaveBeenCalled();
  applyDroraUpdateFeed(updater, "https://updates.example/releases");
  expect(updater.setFeedURL).toHaveBeenCalledWith({
    provider: "generic",
    url: "https://updates.example/releases",
  });
});
