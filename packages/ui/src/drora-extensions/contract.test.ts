import { expect, it } from "vitest";
import { isDroraWorkspaceMainView } from "./WorkspaceMainView.js";
it("Vault extension claims only its own view", () => {
  expect(isDroraWorkspaceMainView("vault")).toBe(true);
  for (const officialView of ["chat", "automation", "workflow"])
    expect(isDroraWorkspaceMainView(officialView)).toBe(false);
});
