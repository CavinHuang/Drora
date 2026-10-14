# 3.14.3 页面历史实现

从 Drora `82b02c14` 迁移的逆向 app/ui/intl 和旧 Vite 配置，仅用于取证和历史回归；不继续开发。原始上游字节资产保留在 ../upstream 和 ../src/recovered。

当前生产、开发页面由 packages/web 与 packages/ui 提供，mobile-web 只做版本资产部署。test 中的历史辅助函数用例保持原断言；当前远控语义由官方 transport/manager/UI 回归与实际 LAN 页面验证。
