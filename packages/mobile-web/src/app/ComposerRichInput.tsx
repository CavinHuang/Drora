// §33.18.18 composer 输入面换装（specs/mobile-relay-r3-frontend.md）：textarea →
// ui 包官方富文本编辑器 LexicalChatInput 窄入口装配（TaskComposer 保留自有工具条
// ——已对齐面不动，仅换输入面）。数据面零依赖：props 全注入（workspacePath/taskId/
// onChange/onSubmit），无 services/store 消费。
// 边界（记录为存续挂账）：@ 文件上下文/附件上传协议面（P7）未通——mention 面关、
// appSlashCommands 空表；提交语义=乐观清空（官方同 UX，失败经错误面呈现）。
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { LexicalChatInputHandle } from "@drora/ui/lexical-chat-input";
import { DroraIntlProvider } from "@drora/ui/git-pane";
import { resolveLocale } from "../ui/intl.js";

const LexicalChatInput = lazy(() =>
  import("@drora/ui/lexical-chat-input").then((module) => ({
    default: module.LexicalChatInput,
  })),
);

export interface ComposerRichInputProps {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId?: string | null;
  placeholder: string;
  disabled?: boolean;
  /** 编辑器文本变化（Lexical 自持状态，onChange 单向上行同步 App draft）。 */
  onChange: (text: string) => void;
  /** 提交（Enter/appSlash 提交语义归编辑器；返回 true=编辑器乐观清空）。 */
  onSubmit: (text: string) => boolean | void;
  /** 初值回填（任务切换时 App draft 重进编辑器；经 handle clear+append）。 */
  initialText?: string;
  inputTestId?: string;
}

export function ComposerRichInput(props: ComposerRichInputProps) {
  // §33.18.19 @/$ 面板 portal 容器（MentionPlugin：!isOpen || !container → null，
  // 桌面壳由 triggerPanelContainer 提供定位容器——本壳自建同位容器）。
  const [panelContainer, setPanelContainer] = useState<HTMLDivElement | null>(null);
  const setPanelContainerRef = useCallback((node: HTMLDivElement | null) => {
    setPanelContainer(node);
  }, []);
  // §33.18.21 初值回填（桌面 ChatPromptEditor syncInitialValueOnMount 同模式）：
  // 懒 chunk 就绪前轮询等编辑器句柄，就绪后一次性 setText（文本相同则跳过，
  // 避免打字期间程序化重写编辑器）。
  const editorApiRef = useRef<LexicalChatInputHandle | null>(null);
  // §33.18.21 初值回填（桌面 ChatPromptEditor syncInitialValueOnMount 同模式）：
  // 懒 chunk 就绪前轮询等编辑器句柄；就绪后按「文本比对」同步下行——打字经
  // onChange 上行后 draft 与编辑器文本一致（跳过），仅外部变更（@file 插入、
  // 草稿恢复、任务切换）才 setText，避免每个字符程序化重写编辑器。
  const editorReady = useRef(false);
  const latestInitialRef = useRef<string | undefined>(undefined);
  latestInitialRef.current = props.initialText;
  useEffect(() => {
    const timer = setInterval(() => {
      if (editorApiRef.current) {
        setEditorReadyState(true);
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  const [editorReadyState, setEditorReadyState] = useState(false);
  useEffect(() => {
    const api = editorApiRef.current;
    const initial = latestInitialRef.current;
    if (!editorReadyState || !api || initial === undefined) return;
    if (api.getText() === initial) return;
    api.setText(initial);
  }, [editorReadyState, props.initialText]);
  return (
    <DroraIntlProvider initialLocale={resolveLocale()}>
      <div ref={setPanelContainerRef} className="relative flex flex-col">
        <Suspense
          fallback={
            // 懒加载 chunk 就绪前的静态兜底（SSR/首帧）：保 testid 与占位形状。
            <textarea
              data-testid={props.inputTestId}
              className="max-h-40 min-h-10 w-full resize-none bg-transparent text-mobile-input-safe leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
              rows={1}
              placeholder={props.placeholder}
              disabled={props.disabled}
              aria-label={props.placeholder}
              value=""
              readOnly
            />
          }
        >
          <LexicalChatInput
            workspacePath={props.workspacePath}
            workspaceIdentity={props.workspaceIdentity}
            taskId={props.taskId ?? null}
            placeholder={props.placeholder}
            disabled={props.disabled ?? false}
            enterSubmits
            onChange={props.onChange}
            onSubmit={(text) => props.onSubmit(text)}
            editorApiRef={editorApiRef}
            inputTestId={props.inputTestId}
            triggerPanelContainer={panelContainer}
          // §33.18.19 @ 文件上下文：mention 面板挂起——MentionPlugin 分组渲染消费
          // droraSessionStore 的 selectedProvider/order（手机 store 无该配置面，
          // undefined.order 崩页面，§33.18.19 续），待 provider 配置面接线后开启。
          enableMentionPanel={false}
          />
        </Suspense>
      </div>
    </DroraIntlProvider>
  );
}
