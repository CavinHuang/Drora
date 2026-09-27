import assert from "node:assert/strict";
import test from "node:test";
import { createAutoUpdateInstallRecovery } from "../src/main/autoUpdateInstallRecovery.js";

// specs/update-feed-github.md「macOS quitAndInstall 失败恢复」：
// 安装请求后的 updater error 必须恰好一次触发恢复回调（弹窗 + 完成退出），
// 未请求安装的 error（后台 staging 失败等）不得触发。
test("error before install request does not trigger recovery", () => {
  let failures = 0;
  const recovery = createAutoUpdateInstallRecovery({
    onInstallFailure: () => {
      failures += 1;
    },
  });

  assert.equal(recovery.handleUpdaterError(new Error("SQRLCodeSignatureErrorDomain")), false);
  assert.equal(failures, 0);
});

test("error after install request triggers recovery exactly once", () => {
  const seenErrors: unknown[] = [];
  const recovery = createAutoUpdateInstallRecovery({
    onInstallFailure: (error) => {
      seenErrors.push(error);
    },
  });

  recovery.markInstallRequested();

  const signatureError = new Error("code failed to satisfy specified code requirement(s)");
  assert.equal(recovery.handleUpdaterError(signatureError), true);
  assert.equal(seenErrors.length, 1);
  assert.equal(seenErrors[0], signatureError);

  // Squirrel 重试或重复上报的 error 不再二次触发恢复（应用已在退出流程中）。
  assert.equal(recovery.handleUpdaterError(new Error("second")), false);
  assert.equal(seenErrors.length, 1);
});

test("recovery can be reused for a subsequent install request", () => {
  let failures = 0;
  const recovery = createAutoUpdateInstallRecovery({
    onInstallFailure: () => {
      failures += 1;
    },
  });

  recovery.markInstallRequested();
  assert.equal(recovery.handleUpdaterError(new Error("first failure")), true);

  // 恢复回调后应用应退出；若宿主未退出并再次请求安装，判定窗口重新打开。
  recovery.markInstallRequested();
  assert.equal(recovery.handleUpdaterError(new Error("second failure")), true);
  assert.equal(failures, 2);
});
