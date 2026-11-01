import { describe, expect, it } from "vitest";
import { resourcePath } from "./routes.ts";

const SITE = "1978123456789012480";
const DEP = "1978123456789012481";

describe("resourcePath", () => {
  it.each([
    ["drora-site://usage", "/api/v1/sites/usage"],
    ["drora-site://plans", "/api/v1/sites/plans"],
    ["drora-site://sites", "/api/v1/sites"],
    ["drora-site://sites?cursor=", "/api/v1/sites"],
    ["drora-site://sites?cursor=a%2Fb&limit=20", "/api/v1/sites?cursor=a%2Fb&limit=20"],
    [`drora-site://sites/${SITE}`, `/api/v1/sites/${SITE}`],
    [
      `drora-site://sites/${SITE}/deployments?cursor=x`,
      `/api/v1/sites/${SITE}/deployments?cursor=x`,
    ],
    [`drora-site://sites/${SITE}/deployments/${DEP}`, `/api/v1/sites/${SITE}/deployments/${DEP}`],
    [`drora-site://sites/${SITE}/cover`, `/api/v1/sites/${SITE}/cover`],
    [
      `drora-site://sites/${SITE}/deployments/${DEP}/logs?offset=12`,
      `/api/v1/sites/${SITE}/deployments/${DEP}/logs?offset=12`,
    ],
  ])("maps %s", (uri, path) => {
    expect(resourcePath(uri)).toBe(path);
  });

  it.each([
    "drora-site://other",
    "https://sites/1",
    "drora-site://usage?cursor=1",
    "drora-site://plans?limit=1",
    "drora-site://plans/free",
    "drora-site://sites/abc",
    "drora-site://sites/0123",
    "drora-site://sites/1/deployments/2/logs/extra",
    "drora-site://sites/1/cover/2",
    "drora-site://sites/1/cover?offset=1",
    "drora-site://sites/1/settings",
    "drora-site://sites/1/deployments/2/logs?offset=-1",
    "drora-site://sites?limit=1e3",
    "drora-site://sites?cursor=a&cursor=b",
    "drora-site://sites/1/deployments/2?offset=1",
    "drora-site://user@sites",
    "drora-site://sites/..%2Fusage",
    "not a uri",
  ])("rejects %s", (uri) => {
    expect(resourcePath(uri)).toBeUndefined();
  });
});
