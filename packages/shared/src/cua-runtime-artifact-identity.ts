/** SDK、冻结 Helper 包和发行 manifest 属于不同角色，不能用 SDK 包名替代产物身份。 */
export const CUA_SDK_PACKAGE_NAME = "@drora/drora-cua";
// 冻结发行资产保留官方名字；打包与 Host 必须引用同一出处。
export const CUA_HELPER_RUNTIME_PACKAGE_NAME = "@zcode/zcode-cua-helper-runtime";
export const CUA_PACKAGED_MANIFEST_PACKAGE_NAME = "@zcode/zcode-cua";
