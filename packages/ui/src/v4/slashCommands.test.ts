/**
 * /mate 本地命令解析单测（specs/drora-personal-assistant.md §11 能力审查修复批）：
 * 裸命令/带正文/verbatim 保留/附件让位/CLI 同名让位矩阵。/side 解析器同门规则
 * （parseSelectionSideSlashCommand）无既有单测，此处只覆盖新增的 mate 面。
 */
import { describe, expect, it } from "vitest";
import { parseMateSlashCommand } from "./slashCommands.js";

describe("parseMateSlashCommand（specs §11 能力审查修复批）", () => {
  it("裸 /mate：text=null（仅开面板）；大小写不敏感", () => {
    expect(parseMateSlashCommand("/mate")).toEqual({
      command: "mate",
      text: null,
      displayText: "/mate",
    });
    expect(parseMateSlashCommand("  /Mate  ")?.text).toBeNull();
  });

  it("带正文：verbatim 保留内部空白与换行，仅去首尾", () => {
    const parsed = parseMateSlashCommand("/mate 修复登录\n第二行 保留  空格 ");
    expect(parsed).toEqual({
      command: "mate",
      text: "修复登录\n第二行 保留  空格",
      displayText: "/mate 修复登录\n第二行 保留  空格",
    });
  });

  it("非 mate 命令与空正文变体：不命中", () => {
    expect(parseMateSlashCommand("/matex 修复")).toBeNull();
    expect(parseMateSlashCommand("mate 修复")).toBeNull();
    expect(parseMateSlashCommand("/mate/todo")).toBeNull();
    expect(parseMateSlashCommand("")).toBeNull();
  });

  it("附件在场让位（与 /side 同规则：结构化上下文不消费）", () => {
    expect(parseMateSlashCommand("/mate 修复", [{ kind: "file" }])).toBeNull();
    expect(parseMateSlashCommand("/mate 修复", [], { contextAttachmentCount: 2 })).toBeNull();
  });

  it("CLI catalog 同名 mate 命令优先（enabledCommandNames 未含 mate 即让位）", () => {
    expect(parseMateSlashCommand("/mate 修复", [], { enabledCommandNames: ["/team", "/side"] })).toBeNull();
    expect(parseMateSlashCommand("/mate 修复", [], { enabledCommandNames: ["/Mate"] })?.text).toBe(
      "修复",
    );
  });

  it("正文仅空白视为裸命令（text=null）", () => {
    expect(parseMateSlashCommand("/mate   ")?.text).toBeNull();
  });
});
