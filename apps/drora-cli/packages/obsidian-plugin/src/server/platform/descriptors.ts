/**
 * ServiceDescriptor —— 以频道名称标识服务并通过泛型关联类型。
 *
 * 迁自 packages/services/src/descriptors.ts @ bf872a6c0（specs/
 * obsidian-vault-phase2-true-extraction.md §1-C1/§10-P3）：知识栈四服务随 C1 物理迁入
 * 插件包后，其源文件对本工厂的相对导入改为指向本副本；services 不允许被插件包反向
 * import（依赖方向约束，见 official-plugin-definitions.ts 同款注释），故按值等价复制。
 * 形状与 services 版逐字节等价（仅注释头差异）：channelName 字符串仍由迁入的服务接口
 * 文件经 @drora/shared ServiceChannels 单一出处提供，本文件不产生任何契约字面量。
 */

export interface ServiceDescriptor<T> {
  readonly channelName: string;
  /** Phantom type — 仅用于类型推断，运行时不存在 */
  readonly _brand?: T;
}

export function createServiceDescriptor<T>(channelName: string): ServiceDescriptor<T> {
  return { channelName };
}
