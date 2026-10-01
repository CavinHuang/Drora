// §32.14 终端侧板面板（specs/mobile-relay-r3-frontend.md）：官方侧板「终端」标签还原。
// 简化 readline 式终端（输出日志 + 输入行，Enter=write），真 xterm 渲染归真机/桌面档
// （spec 记录的有意分歧）；服务面 = accessor.terminalService（ITerminalService 既有，
// 手机桥 accessor 已代理；attach 真通道归桌面侧）。
import { useEffect, useRef, useState } from "react";
import type { ITerminalService } from "@drora/services";

export interface RemoteTerminalPaneProps {
  terminal: ITerminalService;
  workspacePath: string;
}

export function RemoteTerminalPane(props: RemoteTerminalPaneProps) {
  const { terminal, workspacePath } = props;
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const termIdRef = useRef<string | null>(null);
  const outRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let dataEvent: { dispose: () => void } | null = null;
    void (async () => {
      try {
        const created = await terminal.create({ cols: 80, rows: 24, cwd: workspacePath });
        if (disposed) {
          void terminal.dispose({ id: created.id });
          return;
        }
        termIdRef.current = created.id;
        const event = terminal.onDynamicData(created.id);
        const disposable = event((chunk) => {
          setOutput((prev) => (prev + chunk).slice(-8000));
        });
        dataEvent = disposable;
        setReady(true);
      } catch {
        setOutput("terminal unavailable on this attachment.\r\n");
      }
    })();
    return () => {
      disposed = true;
      dataEvent?.dispose();
      const id = termIdRef.current;
      if (id) void terminal.dispose({ id }).catch(() => {});
    };
  }, [terminal, workspacePath]);

  const send = () => {
    const id = termIdRef.current;
    const text = input;
    if (!id || !text.trim()) return;
    setInput("");
    void terminal.write({ id, data: text + "\r\n" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        ref={outRef}
        data-testid="remote-terminal-output"
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all bg-card px-3 py-2 font-mono text-ui-xs text-foreground"
      >
        {output || "…"}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-input px-2 py-1.5">
        <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">$</span>
        <input
          data-testid="remote-terminal-input"
          className="min-w-0 flex-1 bg-transparent font-mono text-ui-sm text-foreground outline-none"
          value={input}
          disabled={!ready}
          placeholder={ready ? "" : "…"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>
    </div>
  );
}
