/**
 * persona 独立库的 worker 入口（cli-persona-store 内部模块；合同 §2「SQLite 位于异步
 * worker」、实施计划 §3.B「正式 worker 最低可运行验证」）。
 *
 * 职责边界：worker 线程持有 DatabaseSync（经 PersonaSqliteStore，唯一实现），主线程经
 * 本协议（persona-store-worker-protocol.ts）调用 PersonaStorePort 同一 API。本文件不含
 * 任何存储语义——打开/迁移/事务/CAS 全部委托同模块的 openPersonaStore。
 *
 * 生命周期（显式时间）：
 * 1. spawn 时经 workerData 收到打开选项，立即 openPersonaStore（含 mkdir/迁移）。
 * 2. 成功 → post {kind:"ready"}；失败 → post {kind:"open-failed"} 后自然退出（worker
 *    无法服务的失败不重试，client 决定对外语义）。
 * 3. 每个 call 顺序派发到 store 同名方法；结构化克隆传值，PersonaStoreError 序列化。
 * 4. close → store.close() 后回执并退出；worker 意外崩溃由 client 的 error/exit 监听
 *    兜住（扩展只停不崩进程，重开语义属服务层，本层不自动重开）。
 *
 * 入口形态：本文件既是可 import 的模块（dist ESM 里与 client 同目录），也被
 * cli/scripts/build.mjs 单独打包成 CJS 字符串注入主 bundle
 * （__DRORA_PERSONA_WORKER_SOURCE__，eval 形态）——因此启动逻辑放在模块顶层的
 * isMainThread 守卫内，两种形态都成立，且被普通 import 时零副作用。
 */
import { isMainThread, parentPort, workerData, type MessagePort } from "node:worker_threads";
import { PERSONA_ERROR_CODES } from "@drora/shared";
import { PersonaStoreError, type PersonaStorePort } from "./contract.js";
import { openPersonaStore } from "./persona-store.js";
import {
  type PersonaWorkerOpenData,
  type PersonaWorkerOpTable,
  type PersonaWorkerRequest,
  type PersonaWorkerResponse,
  type PersonaWorkerSerializedError,
} from "./persona-store-worker-protocol.js";

function serializeStoreError(error: unknown): PersonaWorkerSerializedError {
  if (error instanceof PersonaStoreError) {
    return { code: error.code, message: error.message, dbPath: error.dbPath };
  }
  // 意外异常（仓储 bug/未知库错误）：对外只有 storage_unavailable 一种诚实表达；
  // 原文 message 保留供诊断，不落个人正文。
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { code: PERSONA_ERROR_CODES.storageUnavailable, message };
}

async function dispatchCall(store: PersonaStorePort, op: string, input: unknown): Promise<unknown> {
  // 同一信任域的内部协议（见文件头）：形状由 client 保证，按表断言后直呼同名方法。
  switch (op as keyof PersonaWorkerOpTable) {
    case "readSnapshot":
      return store.readSnapshot();
    case "initializeAuthority":
      return store.initializeAuthority(
        input as Parameters<PersonaStorePort["initializeAuthority"]>[0],
      );
    case "updateCore":
      return store.updateCore(input as Parameters<PersonaStorePort["updateCore"]>[0]);
    case "updatePolicy":
      return store.updatePolicy(input as Parameters<PersonaStorePort["updatePolicy"]>[0]);
    case "savePreference":
      return store.savePreference(input as Parameters<PersonaStorePort["savePreference"]>[0]);
    case "forgetPreference":
      return store.forgetPreference(input as Parameters<PersonaStorePort["forgetPreference"]>[0]);
    case "allowLearningForKey":
      return store.allowLearningForKey(
        input as Parameters<PersonaStorePort["allowLearningForKey"]>[0],
      );
    case "listPreferences":
      return store.listPreferences();
    case "readExportSnapshot":
      return store.readExportSnapshot();
    case "learning.acceptLearningEvidence":
      return store.learning.acceptLearningEvidence(
        input as Parameters<PersonaStorePort["learning"]["acceptLearningEvidence"]>[0],
      );
    case "learning.claimLearningWork":
      return store.learning.claimLearningWork(
        input as Parameters<PersonaStorePort["learning"]["claimLearningWork"]>[0],
      );
    case "learning.commitLearningWork":
      return store.learning.commitLearningWork(
        input as Parameters<PersonaStorePort["learning"]["commitLearningWork"]>[0],
      );
    case "learning.settleLearningWork":
      return store.learning.settleLearningWork(
        input as Parameters<PersonaStorePort["learning"]["settleLearningWork"]>[0],
      );
    case "learning.reserveLearningBudget":
      return store.learning.reserveLearningBudget(
        input as Parameters<PersonaStorePort["learning"]["reserveLearningBudget"]>[0],
      );
    case "learning.settleLearningBudget":
      return store.learning.settleLearningBudget(
        input as Parameters<PersonaStorePort["learning"]["settleLearningBudget"]>[0],
      );
    case "learning.readLearningBudgetUsage":
      return store.learning.readLearningBudgetUsage(input as number);
    case "learning.readInferredSlotSources":
      return store.learning.readInferredSlotSources();
    case "learning.hasLearningEvidence":
      return store.learning.hasLearningEvidence(input as string);
    default:
      throw new PersonaStoreError(`Unknown persona worker op: ${op}`, {
        code: PERSONA_ERROR_CODES.storageUnavailable,
      });
  }
}

/** 处理单条请求；错误一律转化为回执 postMessage，不向调用方抛出。 */
async function handleWorkerMessage(
  port: MessagePort,
  store: PersonaStorePort,
  request: PersonaWorkerRequest,
): Promise<void> {
  if (request.kind === "close") {
    try {
      await store.close();
      port.postMessage({
        kind: "result",
        id: request.id,
        ok: true,
        value: undefined,
      } satisfies PersonaWorkerResponse);
    } catch (error) {
      port.postMessage({
        kind: "result",
        id: request.id,
        ok: false,
        error: serializeStoreError(error),
      } satisfies PersonaWorkerResponse);
    } finally {
      // close 是最后一条请求（client 关闭后不再发新请求）；回执后结束线程。
      port.close();
    }
    return;
  }
  try {
    const value = await dispatchCall(store, request.op, request.input);
    port.postMessage({
      kind: "result",
      id: request.id,
      ok: true,
      value,
    } satisfies PersonaWorkerResponse);
  } catch (error) {
    port.postMessage({
      kind: "result",
      id: request.id,
      ok: false,
      error: serializeStoreError(error),
    } satisfies PersonaWorkerResponse);
  }
}

/** worker 模式主循环：打开库 → ready → 顺序服务请求；close 后退出。 */
export async function runPersonaWorkerServer(
  port: MessagePort,
  options: PersonaWorkerOpenData,
): Promise<void> {
  let store: PersonaStorePort;
  try {
    store = await openPersonaStore(options);
  } catch (error) {
    const response: PersonaWorkerResponse = {
      kind: "open-failed",
      error: serializeStoreError(error),
    };
    port.postMessage(response);
    return;
  }
  port.postMessage({ kind: "ready" } satisfies PersonaWorkerResponse);
  // 逐消息串行（CONTRACT「管理请求在飞时 close 会等待回执」的机制保障）：每条消息的
  // 处理链式接在前一条完成之后。业务事务本身经 txn 队列互斥，但事务在 BUSY 退避的
  // sleep 处让出事件循环——没有这层消息链时，close 的 store.close() 可在该窗口并发
  // 执行，把在飞请求打成 storage_unavailable。handler 已把所有错误转为回执，链上的
  // catch 只是防御（保持链不断）。
  let tail: Promise<void> = Promise.resolve();
  port.on("message", (raw: unknown) => {
    tail = tail
      .then(() => handleWorkerMessage(port, store, raw as PersonaWorkerRequest))
      .catch(() => undefined);
  });
}

// 模块顶层守卫：仅当本文件作为 worker 入口被执行时才启动服务；被普通 import（client/
// 测试）时零副作用。dist 文件与注入字符串（eval）两种入口形态共用这一段。
if (!isMainThread && parentPort) {
  void runPersonaWorkerServer(parentPort, workerData as PersonaWorkerOpenData);
}
