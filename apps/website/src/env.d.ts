declare module "*.css";
declare module "@drora/ui/styles.css";

/* ui 包（Vite 生态）个别模块读取 import.meta.env（Vite 注入）。
 * Next 构建经 DefinePlugin 编译期替换这些成员表达式；类型在此补齐。 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
