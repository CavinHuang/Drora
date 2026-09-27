// 「已请求安装、等待退出」的单一所有者（specs/update-feed-github.md「macOS
// quitAndInstall 失败恢复」）。quitAndInstallUpdate 把控制权交给
// electron-updater 后，macOS Squirrel 的安装任务异步执行，失败经 error 事件
// 迟到上报（实测 ~9s）。常规失败收敛只清 ready 回 idle，会让应用停留在半退出
// 态（host 已回收、forceQuit 已标记）。这里判定「安装请求后的 error」并保证
// 恢复回调恰好触发一次；未请求安装的 error（后台 staging 失败等）不经过本模块。
export interface AutoUpdateInstallRecoveryOptions {
  onInstallFailure: (error: unknown) => void;
}

export interface AutoUpdateInstallRecovery {
  markInstallRequested(): void;
  /** 返回 true 表示该 error 属于安装失败且恢复回调已触发，调用方不再走常规收敛。 */
  handleUpdaterError(error: unknown): boolean;
}

export function createAutoUpdateInstallRecovery(
  options: AutoUpdateInstallRecoveryOptions,
): AutoUpdateInstallRecovery {
  let installRequested = false;
  let failureHandled = false;

  return {
    markInstallRequested() {
      installRequested = true;
      failureHandled = false;
    },
    handleUpdaterError(error: unknown): boolean {
      if (!installRequested || failureHandled) {
        return false;
      }
      failureHandled = true;
      installRequested = false;
      options.onInstallFailure(error);
      return true;
    },
  };
}
