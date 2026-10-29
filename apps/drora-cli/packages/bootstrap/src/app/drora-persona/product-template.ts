/**
 * 版本化产品模板资产（ProductTemplate/P0；数据合同 §1「随发行的只读资产；设置中可审阅，
 * 不接受自动学习 patch」；spec §2 默认核心语义）。
 *
 * - templateVersion / compilerVersion 字面量唯一出处是 shared contracts 的
 *   PERSONA_TEMPLATE_VERSION / PERSONA_COMPILER_VERSION；正文与受控情境词汇随
 *   templateVersion 冻结，正文变更必须递增版本并重走评测（spec §2「最终中英文模板须
 *   独立版本化和评测」）。
 * - 默认核心引用 cli-persona-domain 的 defaultPersonaCore（spec §4：core/persona 拥有
 *   纯编译与字段资格；本资产不复制第二份默认值）。
 * - 实际编译只走 cli-persona-domain 的 compilePersonaCore；本资产的审阅字段是编译内嵌
 *   产品规则的忠实摘要，不是第二条编译路径。
 * - 「模板超限是构建期错误不是运行期兜底」（合同 §1.1）：compiledContributionMax 由编译
 *   层保证；最坏字段组合（40 code point 称呼＋300 code point 自我描述）是否超限由
 *   tests/persona 的构建期断言钉住——超限必须改模板并递增版本，运行期不截断、不静默缩写。
 */
import { defaultPersonaCore, type PersonaCore } from "@drora/core/persona";
import {
  PERSONA_COMPILER_VERSION,
  PERSONA_TEMPLATE_VERSION,
  type PersonaProductTemplateSummary,
} from "@drora/shared";

/** 完整模板资产：可审阅摘要（shared 类型）＋服务拥有的默认核心与预览情境词汇。 */
export interface ProductPersonaTemplate extends PersonaProductTemplateSummary {
  /** 显式初始化写入独立库的产品默认核心（合同 §1.1 默认列；引用 core 单一出处）。 */
  readonly defaultCore: PersonaCore;
  /**
   * previewPersona 的受控情境 id 词汇（合同 §3「受控情境 id 由 templateVersion 拥有」）。
   * v1 编译器没有情境参数，情境集为空：任何显式情境 id 都报 validation_failed，
   * 不发明不影响输出的假情境。
   */
  readonly situationIds: readonly string[];
}

const PRODUCT_PERSONA_TEMPLATE_V1: ProductPersonaTemplate = Object.freeze({
  templateVersion: PERSONA_TEMPLATE_VERSION,
  compilerVersion: PERSONA_COMPILER_VERSION,
  identityStatement:
    "Drora is a digital partner for work and everyday conversation, with one continuous identity.",
  principles: Object.freeze([
    "Be honest, curious, considerate and willing to disagree with reasons.",
    "Admit uncertainty and correct mistakes.",
    "Respect the user's independence; do not maintain the interaction by flattery.",
  ]),
  capabilityHonesty:
    "Expression defaults never grant tool permissions or change execution scope; report capabilities from the actual environment, not from an identity description.",
  relationshipBoundary:
    "Do not demand exclusivity, invent shared experiences, or claim to watch or wait for the user; do not describe shared history without evidence.",
  defaultCore: defaultPersonaCore,
  situationIds: Object.freeze([]),
});

/** 随发行冻结的只读模板资产；同一进程内总是同一冻结实例。 */
export function getProductPersonaTemplate(): ProductPersonaTemplate {
  return PRODUCT_PERSONA_TEMPLATE_V1;
}
