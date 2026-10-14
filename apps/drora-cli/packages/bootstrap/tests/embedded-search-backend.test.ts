import { describe, expect, it } from "vitest";
import { resolveDefaultEmbeddedSearchBackend } from "../src/app/embedded-search-backend.js";

describe("resolveDefaultEmbeddedSearchBackend", () => {
  it("uses bundled bfs, ugrep, and ripgrep paths by default", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: {
          DRORA_BFS_BINARY: "/opt/drora/tools/bfs/bfs",
          DRORA_RG_BINARY: "/opt/drora/tools/ripgrep/rg",
          DRORA_UGREP_BINARY: "/opt/drora/tools/ugrep/ugrep",
        },
      }),
    ).toEqual({
      kind: "native-binaries",
      findCommand: "/opt/drora/tools/bfs/bfs",
      grepCommand: "/opt/drora/tools/ugrep/ugrep",
      rgCommand: "/opt/drora/tools/ripgrep/rg",
    });
  });

  it("falls back to bfs, ugrep, and rg command names when bundled paths are unavailable", () => {
    expect(resolveDefaultEmbeddedSearchBackend({ env: {} })).toEqual({
      kind: "native-binaries",
      findCommand: "bfs",
      grepCommand: "ugrep",
      rgCommand: "rg",
    });
  });

  it("preserves the explicit internal CLI compatibility override", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: { DRORA_EMBEDDED_SEARCH_COMMAND: "/tmp/drora-test" },
      }),
    ).toEqual({
      kind: "internal-cli",
      command: "/tmp/drora-test",
      args: ["__internal-search"],
    });
  });
});
