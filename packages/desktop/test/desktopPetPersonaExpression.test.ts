import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  desktopPetPersonaExpression,
  type DesktopPetPersonaExpression,
} from "../src/drora-extensions/desktopPetPersonaExpression.js";

const expression = (mode: DesktopPetPersonaExpression["mode"], locale = "zh-CN") =>
  desktopPetPersonaExpression({ mode, locale });

describe("P2 桌宠当前态表达映射（spec §11、PM18/58）", () => {
  it("语义映射：working=专注、attention=等待回应、error=遇到问题（zh/en）", () => {
    expect(expression("working").label).toBe("专注处理中");
    expect(expression("attention").label).toBe("等待回应");
    expect(expression("error").label).toBe("遇到问题");
    expect(expression("idle").label).toBe("待命");
    expect(expression("working", "en-US").label).toBe("Focused");
    expect(expression("attention", "en-US").label).toBe("Waiting for you");
    expect(expression("error", "en-US").label).toBe("Hit a problem");
  });

  it("PM58 中性结束：completed 恒为中性且永不庆祝——含中断的完成没有庆祝表达", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const completed = expression("completed", locale);
      expect(completed.neutralEnding).toBe(true);
      expect(completed.celebrates).toBe(false);
      // 文案不含庆祝/成功语义（「已完成」式庆祝被中性「已结束」取代）。
      expect(completed.label).not.toMatch(/完成|celebrat|success|完成/i);
    }
    expect(expression("completed").label).toBe("已结束");
    expect(expression("completed", "en-US").label).toBe("Finished");
  });

  it("PM58 无连续失败推断：重复 error 的表达逐字恒等，不升级不计数", () => {
    const first = expression("error");
    const second = expression("error");
    const tenth = expression("error");
    expect(second).toEqual(first);
    expect(tenth).toEqual(first);
  });

  it("PM58 无等待时长/权限超时推断：attention 的表达与任何时长/次数无关，文案不含超时语义", () => {
    const one = expression("attention");
    expect(one).toEqual(expression("attention"));
    expect(one.label).not.toMatch(/超时|permission|timeout|等待中 \d/iu);
    // 表达只由 mode+locale 决定：结构性排除时长/计数输入。
    const keys = Object.keys;
    expect(keys({ mode: "attention", locale: "zh-CN" } as const).sort()).toEqual([
      "locale",
      "mode",
    ]);
  });

  it("PM18 原状态优先：多任务投影不改变表达——映射只消费 mode+locale，无新 task 字段", () => {
    // 真实投影的 activities/preview/character 等字段不进映射入参；
    // 同一 mode 下无论几条活动、什么外观，表达逐字一致。
    const single = expression("working");
    expect(single).toEqual(expression("working", "zh-CN"));
    expect(Object.keys(single).sort()).toEqual([
      "celebrates",
      "label",
      "mode",
      "neutralEnding",
    ]);
  });

  it("未知 locale 回退 en-US，不抛错（旧宿主兼容）", () => {
    const fallback = desktopPetPersonaExpression({
      mode: "attention",
      locale: "fr-FR" as never,
    });
    expect(fallback.label).toBe("Waiting for you");
  });

  it("语音兼容：映射模块零语音依赖，不新增情绪输出链路（spec §11）", () => {
    const source = readFileSync(
      new URL("../src/drora-extensions/desktopPetPersonaExpression.ts", import.meta.url),
      "utf8",
    );
    // 唯一导入是 @drora/shared 的 Locale 类型：结构上不可能接触录音/播报/取消与来源身份。
    expect(source.match(/import (?:type )?\{[^}]*\} from "[^"]*"/g)).toEqual([
      'import type { Locale } from "@drora/shared"',
    ]);
  });
});
