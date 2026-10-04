// 仅持有时间线“正在加载”的 UI 状态；分页行仍由 TaskSession/store 拥有。
import { useCallback, useRef, useState, type RefObject } from "react";
import type { TaskSession } from "./taskSession.js";

export function useTaskHistory(taskRef: RefObject<TaskSession | null>) {
  const [loadingOlder, setLoadingOlder] = useState(false);
  const generationRef = useRef(0);

  const resetOlder = useCallback(() => {
    generationRef.current += 1;
    setLoadingOlder(false);
  }, []);

  const loadOlder = useCallback(async () => {
    const session = taskRef.current;
    if (!session || !session.canLoadOlder) return;
    const generation = generationRef.current;
    setLoadingOlder(true);
    try {
      await session.loadOlder();
    } catch {
      // 滚动回调不等待 Promise；桥断开时在此收敛，避免未处理拒绝中断会话面。
    } finally {
      if (generationRef.current === generation) setLoadingOlder(false);
    }
  }, [taskRef]);

  return { loadingOlder, loadOlder, resetOlder };
}
