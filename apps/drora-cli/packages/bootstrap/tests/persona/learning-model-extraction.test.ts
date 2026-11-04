/**
 * 真实模型抽取适配器单测（specs/drora-persona-system.md §13 第十四批）。
 *
 * 只钉适配器自身的分层职责：请求构造（system/user、结构化 schema、输出上界）、
 * JSON 解析与顶层形状检查（失败→no_candidates 不虚构）、usage 回传、语义草稿
 * 一律透传（键值/引用合法性由编排器机械闸与 owner 复验裁决，本层不重复裁决）。
 * 语义负例（PM38/40/48）由评测 harness 用真实模型验证，不在本文件。
 */
import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelResult } from "@drora/contracts";
import { PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import { createModelPersonaLearningExtractor } from "../../src/app/drora-persona/learning-model-extraction.js";

interface RecordingCaller {
  readonly requests: ModelRequest[];
  generateText(request: ModelRequest): Promise<ModelResult>;
}

function recordingCaller(
  respond: (request: ModelRequest, call: number) => ModelResult,
): RecordingCaller {
  const caller: RecordingCaller = {
    requests: [],
    async generateText(request: ModelRequest): Promise<ModelResult> {
      caller.requests.push(request);
      return respond(request, caller.requests.length);
    },
  };
  return caller;
}

const TEXT_RESULT = (text: string, usage?: ModelResult["usage"]): ModelResult => ({
  text,
  finishReason: "stop",
  usage: usage ?? { inputTokens: 100, outputTokens: 20 },
});

describe("persona P1b 真实模型抽取适配器", () => {
  it("availability=configured；请求为 system+user 两条消息，携带结构化 schema 与默认输出上界", async () => {
    const caller = recordingCaller(() => TEXT_RESULT('{"drafts":[]}'));
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    expect(extractor.availability).toBe("configured");

    await extractor.extract({ evidenceId: "pev-1", messages: ["以后请叫我「老黄」，全局。"] });

    expect(caller.requests).toHaveLength(1);
    const request = caller.requests[0]!;
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]!.role).toBe("system");
    expect(request.messages[1]!.role).toBe("user");
    expect(request.messages[1]!.content).toContain("[1] 以后请叫我「老黄」，全局。");
    expect(request.options?.maxOutputTokens).toBe(1024);
    const schema = request.responseJsonSchema as { properties: { drafts: { maxItems: number } } };
    expect(schema.properties.drafts.maxItems).toBe(4);
  });

  it("解析合格草稿并回传 usage", async () => {
    const caller = recordingCaller(() =>
      TEXT_RESULT(
        JSON.stringify({
          drafts: [
            {
              key: PERSONA_PREFERENCE_KEYS.preferredAddress,
              value: "老黄",
              scope: "global",
              evidenceRefs: ["以后请叫我「老黄」"],
            },
          ],
        }),
        { inputTokens: 311, outputTokens: 57 },
      ),
    );
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    const outcome = await extractor.extract({ evidenceId: "pev-1", messages: ["以后请叫我「老黄」，全局。"] });
    expect(outcome).toEqual({
      status: "extracted",
      drafts: [
        {
          key: PERSONA_PREFERENCE_KEYS.preferredAddress,
          value: "老黄",
          scope: "global",
          evidenceRefs: ["以后请叫我「老黄」"],
        },
      ],
      usage: { inputTokens: 311, outputTokens: 57 },
    });
  });

  it("markdown 代码块包裹的 JSON 仍可解析", async () => {
    const caller = recordingCaller(() =>
      TEXT_RESULT('```json\n{"drafts":[]}\n```'),
    );
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    const outcome = await extractor.extract({ evidenceId: "pev-1", messages: ["普通消息"] });
    expect(outcome.status).toBe("no_candidates");
    expect("drafts" in outcome).toBe(false);
  });

  it("JSON 解析失败 → no_candidates 且 usage 照实回传（不虚构不重试）", async () => {
    const caller = recordingCaller(() =>
      TEXT_RESULT("抱歉，我无法输出 JSON。", { inputTokens: 90, outputTokens: 12 }),
    );
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    const outcome = await extractor.extract({ evidenceId: "pev-1", messages: ["普通消息"] });
    expect(outcome).toEqual({ status: "no_candidates", usage: { inputTokens: 90, outputTokens: 12 } });
    expect(caller.requests).toHaveLength(1);
  });

  it("顶层形状不对（drafts 非数组/条目缺字段）→ no_candidates", async () => {
    const broken = ['{"drafts":"none"}', '{"items":[]}', '{"drafts":[{"key":"replyLanguage"}]}'];
    for (const [index, text] of broken.entries()) {
      const caller = recordingCaller(() => TEXT_RESULT(text));
      const extractor = createModelPersonaLearningExtractor({ model: caller });
      const outcome = await extractor.extract({ evidenceId: `pev-${index}`, messages: ["普通消息"] });
      expect(outcome.status).toBe("no_candidates");
    }
  });

  it("非法键/非法值的草稿原样透传（机械闸属编排器，本层不裁决）", async () => {
    const caller = recordingCaller(() =>
      TEXT_RESULT(
        JSON.stringify({
          drafts: [
            { key: "favoriteColor", value: "blue", scope: "global", evidenceRefs: ["随便"] },
          ],
        }),
      ),
    );
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    const outcome = await extractor.extract({ evidenceId: "pev-1", messages: ["随便"] });
    expect(outcome.status).toBe("extracted");
    if (outcome.status === "extracted") {
      expect(outcome.drafts[0]!.key).toBe("favoriteColor");
    }
  });

  it("usage 缺失或全 0 → outcome 不带 usage 字段", async () => {
    const caller = recordingCaller(() => TEXT_RESULT('{"drafts":[]}', { inputTokens: 0, outputTokens: 0 }));
    const extractor = createModelPersonaLearningExtractor({ model: caller });
    const outcome = await extractor.extract({ evidenceId: "pev-1", messages: ["普通消息"] });
    expect(outcome).toEqual({ status: "no_candidates" });
  });

  it("自定义 maxOutputTokens 透传到请求", async () => {
    const caller = recordingCaller(() => TEXT_RESULT('{"drafts":[]}'));
    const extractor = createModelPersonaLearningExtractor({ model: caller, maxOutputTokens: 256 });
    await extractor.extract({ evidenceId: "pev-1", messages: ["普通消息"] });
    expect(caller.requests[0]!.options?.maxOutputTokens).toBe(256);
  });
});
