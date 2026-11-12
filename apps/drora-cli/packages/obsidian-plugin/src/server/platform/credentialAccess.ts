/**
 * 凭据读取面（P3/§11-D8，建议值先行）：与 services `ICredentialService` 的
 * `Pick<..., "load">` 面结构等价的本地类型。迁入的 decision/jevAssembly.ts 原经
 * services credential 模块读取 decision-jev API Key；插件进程不链接 services 包
 * （依赖方向约束，见 platform/descriptors.ts 头注释），且 D8 终裁方向是 Jev 配置
 * 静态化（userConfig sensitive 注入 env，android 先例）——接线落地前插件 server
 * 一律不注入读取器，resolveKnowledgeJevAssembly 走 fail-closed 关闭分支。
 * 双轨期本体侧（node.ts 装配）仍用 services 自己的 credential 实现，行为不变。
 */

/** 结构等价于 `Pick<ICredentialService, "load">`（packages/services/src/credential/credential.ts）。 */
export interface KnowledgeCredentialReader {
  load(key: string): Promise<string | null>;
}
