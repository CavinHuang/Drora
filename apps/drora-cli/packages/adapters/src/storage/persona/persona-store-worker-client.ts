/**
 * persona 独立库的异步 worker client（cli-persona-store 内部模块；合同 §2「SQLite 位于
 * 异步 worker」）。实现与 PersonaSqliteStore 完全相同的 PersonaStorePort：存储语义全部在
 * worker 内的 PersonaSqliteStore（唯一实现），本文件只做消息传递与生命周期。
 *
 * 生命周期与故障处置（显式时间）：
 * 1. spawn → worker 打开/迁移库 → ready 回执后 open() 才 resolve；open-failed 按原错误
 *    码重水化拒绝（client 不解读失败原因）。
 * 2. 请求经 postMessage FIFO 到达 worker，与在程实现同一事务队列串行语义一致；回执按
 *    id 配对。排队不消耗任何预算（预算计时在 worker 内的事务真正开跑后才起算）。
 * 3. worker 'error'/'exit'：在飞请求一律以 storage_unavailable 拒绝，之后的调用同样
 *    拒绝——扩展只停不崩进程（PM16）；本层不自动重开（重开/降级语义属服务层）。
 * 4. close()：幂等；发送 close 请求 → worker 关库回执后退出；已 broken 时直接 resolve
 *    （库随线程消亡，无需二次关闭）。
 *
 * worker 入口两种形态（见 persona-store-worker-main.ts 文件头）：
 * - 打包态：cli/scripts/build.mjs 把 worker 入口单独 bundle 成 CJS 字符串，经 esbuild
 *   define 注入 __DRORA_PERSONA_WORKER_SOURCE__，以 eval 形态 spawn——单文件产物
 *   （drora.cjs / SEA / desktop-agent 内置 bundle）因此无需携带旁挂文件。
 * - 非打包态（dist ESM、vitest）：spawn 同目录的 persona-store-worker-main.js；vitest
 *   直接跑 src/*.ts 时映射到同包 dist（worker 入口必须是已编译 JS，Node worker 不加载 TS）。
 */
import { Worker } from "node:worker_threads";
import { PERSONA_ERROR_CODES, type PersonaManagementResult } from "@drora/shared";
import { PersonaStoreError, type PersonaStoreOptions, type PersonaStorePort } from "./contract.js";
import type {
  PersonaLearningAcceptResult,
  PersonaLearningBudgetReservation,
  PersonaLearningBudgetSettleResult,
  PersonaLearningBudgetUsage,
  PersonaLearningClaimResult,
  PersonaLearningCommitResult,
  PersonaLearningSettleWorkResult,
  PersonaLearningSlotSourceBinding,
  PersonaLearningStorePort,
} from "./persona-learning-contract.js";
import {
  type PersonaWorkerOpTable,
  type PersonaWorkerRequest,
  type PersonaWorkerResponse,
  type PersonaWorkerSerializedError,
} from "./persona-store-worker-protocol.js";

/**
 * 打包态注入的 worker bundle 源码；仅 cli/scripts/build.mjs 的主 bundle 构建经 esbuild
 * define 提供该值。dist/dev 形态下该标识符不存在，typeof 探测安全返回 "undefined"。
 */
declare const __DRORA_PERSONA_WORKER_SOURCE__: string | undefined;

/**
 * 测试/诊断用的 worker 线程句柄登记（WeakMap；不进入 PersonaWorkerStore 公开表面）。
 */
const workerRefs = new WeakMap<PersonaWorkerStore, Worker>();

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: PersonaStoreError) => void;
}

export class PersonaWorkerStore implements PersonaStorePort {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private broken: PersonaStoreError | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly worker: Worker,
    private readonly dbPath: string,
  ) {
    workerRefs.set(this, worker);
    worker.on("message", (raw: unknown) => {
      this.onMessage(raw as PersonaWorkerResponse);
    });
    // 两个监听都必须在场：没有 error 监听时 worker 异常会以 uncaught exception 形式
    // 打穿主进程——这违反「扩展只停不崩进程」的处置边界（PM16）。
    worker.on("error", (error: Error) => {
      this.markBroken(
        new PersonaStoreError(`Persona store worker failed: ${error.message}`, {
          code: PERSONA_ERROR_CODES.storageUnavailable,
          cause: error,
          dbPath: this.dbPath,
        }),
      );
    });
    worker.once("exit", (code: number) => {
      // 正常 close：close 回执已让 pending 清空，退出不再算故障。
      if (this.closed && this.pending.size === 0) return;
      this.markBroken(
        new PersonaStoreError(
          `Persona store worker exited unexpectedly before close (exit code ${code})`,
          { code: PERSONA_ERROR_CODES.storageUnavailable, dbPath: this.dbPath },
        ),
      );
    });
  }

  /** 打开 worker 库：open 握手（ready）成功才返回可用实例；失败按原错误码语义拒绝。 */
  static async open(options: PersonaStoreOptions): Promise<PersonaWorkerStore> {
    // 与 engine open 的前置校验一致（同文案同错误码）；在 spawn 之前失败，不开线程。
    if (!options.dbPath) {
      throw new PersonaStoreError("Persona store requires a caller-provided database path", {
        code: PERSONA_ERROR_CODES.storageUnavailable,
      });
    }
    const { worker, ready } = spawnPersonaWorker(options);
    const store = new PersonaWorkerStore(worker, options.dbPath);
    try {
      await ready;
      return store;
    } catch (error) {
      // open 阶段失败：worker 已退出或即将退出；terminate 兜底避免僵尸线程。
      void worker.terminate().catch(() => undefined);
      throw error;
    }
  }

  private onMessage(message: PersonaWorkerResponse): void {
    if (message.kind !== "result") return; // ready/open-failed 由 open 握手通道处理。
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.value);
    } else {
      pending.reject(deserializeStoreError(message.error));
    }
  }

  private markBroken(error: PersonaStoreError): void {
    if (this.broken) return;
    this.broken = error;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private callUnchecked<O extends keyof PersonaWorkerOpTable>(
    op: O,
    input: PersonaWorkerOpTable[O]["input"],
  ): Promise<PersonaWorkerOpTable[O]["output"]> {
    if (this.closed) {
      return Promise.reject(this.closedError());
    }
    if (this.broken) {
      return Promise.reject(
        new PersonaStoreError(this.broken.message, {
          code: PERSONA_ERROR_CODES.storageUnavailable,
          dbPath: this.dbPath,
        }),
      );
    }
    const id = this.nextId;
    this.nextId += 1;
    const request: PersonaWorkerRequest = { kind: "call", id, op, input };
    return new Promise<PersonaWorkerOpTable[O]["output"]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage(request);
    });
  }

  private closedError(): PersonaStoreError {
    // 与 PersonaSqliteStore（PersonaSqliteTxnRunner.assertOpen）同文案同错误码。
    return new PersonaStoreError("Persona store is closed", {
      code: PERSONA_ERROR_CODES.storageUnavailable,
      dbPath: this.dbPath,
    });
  }

  // ---------------------------------------------------------------------------
  // PersonaStorePort（管理面）——与 PersonaSqliteStore 同一合同，仅传输层不同
  // ---------------------------------------------------------------------------

  readSnapshot(): Promise<PersonaWorkerOpTable["readSnapshot"]["output"]> {
    return this.callUnchecked("readSnapshot", undefined);
  }

  initializeAuthority(
    input: Parameters<PersonaStorePort["initializeAuthority"]>[0],
  ): ReturnType<PersonaStorePort["initializeAuthority"]> {
    return this.callUnchecked("initializeAuthority", input);
  }

  updateCore(
    input: Parameters<PersonaStorePort["updateCore"]>[0],
  ): ReturnType<PersonaStorePort["updateCore"]> {
    return this.callUnchecked("updateCore", input);
  }

  updatePolicy(
    input: Parameters<PersonaStorePort["updatePolicy"]>[0],
  ): ReturnType<PersonaStorePort["updatePolicy"]> {
    return this.callUnchecked("updatePolicy", input);
  }

  savePreference(
    input: Parameters<PersonaStorePort["savePreference"]>[0],
  ): ReturnType<PersonaStorePort["savePreference"]> {
    return this.callUnchecked("savePreference", input);
  }

  forgetPreference(
    input: Parameters<PersonaStorePort["forgetPreference"]>[0],
  ): ReturnType<PersonaStorePort["forgetPreference"]> {
    return this.callUnchecked("forgetPreference", input);
  }

  allowLearningForKey(
    input: Parameters<PersonaStorePort["allowLearningForKey"]>[0],
  ): ReturnType<PersonaStorePort["allowLearningForKey"]> {
    return this.callUnchecked("allowLearningForKey", input);
  }

  listPreferences(): ReturnType<PersonaStorePort["listPreferences"]> {
    return this.callUnchecked("listPreferences", undefined);
  }

  readExportSnapshot(): ReturnType<PersonaStorePort["readExportSnapshot"]> {
    return this.callUnchecked("readExportSnapshot", undefined);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    if (this.broken) {
      // worker 已死：库随线程消亡；与 engine 的幂等 close 语义一致，不再报错。
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    const worker = this.worker;
    this.closePromise = new Promise<void>((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
      });
      const closeRequest: PersonaWorkerRequest = { kind: "close", id };
      worker.postMessage(closeRequest);
    });
    try {
      await this.closePromise;
    } finally {
      // 回执后 worker 会自行退出；terminate 只兜底（worker 卡死时不让线程泄漏）。
      void worker.terminate().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // PersonaLearningStorePort（P1b 学习面）——同一 worker、同一事务队列
  // ---------------------------------------------------------------------------

  readonly learning: PersonaLearningStorePort = {
    acceptLearningEvidence: (
      input: Parameters<PersonaLearningStorePort["acceptLearningEvidence"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningAcceptResult>> =>
      this.callUnchecked("learning.acceptLearningEvidence", input),
    claimLearningWork: (
      input: Parameters<PersonaLearningStorePort["claimLearningWork"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningClaimResult>> =>
      this.callUnchecked("learning.claimLearningWork", input),
    commitLearningWork: (
      input: Parameters<PersonaLearningStorePort["commitLearningWork"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningCommitResult>> =>
      this.callUnchecked("learning.commitLearningWork", input),
    settleLearningWork: (
      input: Parameters<PersonaLearningStorePort["settleLearningWork"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningSettleWorkResult>> =>
      this.callUnchecked("learning.settleLearningWork", input),
    reserveLearningBudget: (
      input: Parameters<PersonaLearningStorePort["reserveLearningBudget"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningBudgetReservation>> =>
      this.callUnchecked("learning.reserveLearningBudget", input),
    settleLearningBudget: (
      input: Parameters<PersonaLearningStorePort["settleLearningBudget"]>[0],
    ): Promise<PersonaManagementResult<PersonaLearningBudgetSettleResult>> =>
      this.callUnchecked("learning.settleLearningBudget", input),
    readLearningBudgetUsage: (
      now: number,
    ): Promise<PersonaManagementResult<PersonaLearningBudgetUsage>> =>
      this.callUnchecked("learning.readLearningBudgetUsage", now),
    readInferredSlotSources: (): Promise<
      PersonaManagementResult<readonly PersonaLearningSlotSourceBinding[]>
    > => this.callUnchecked("learning.readInferredSlotSources", undefined),
    hasLearningEvidence: (evidenceId: string): Promise<PersonaManagementResult<boolean>> =>
      this.callUnchecked("learning.hasLearningEvidence", evidenceId),
  };
}

/**
 * 打开 worker 形态的 persona 独立库（生产默认入口；bootstrap 进程组合经此装配）。
 * 与 openPersonaStore（在程 engine）同一 PersonaStorePort 合同；差异仅在传输层与
 * 生命周期，见文件头。
 */
export async function openWorkerPersonaStore(
  options: PersonaStoreOptions,
): Promise<PersonaWorkerStore> {
  return PersonaWorkerStore.open(options);
}

/**
 * 仅供测试与诊断：终止底层 worker 线程，模拟 worker 崩溃路径（PM16 处置语义的验证入口）。
 * 生产代码不得调用——正常关闭走 close()。
 */
export function terminatePersonaWorkerForTests(store: PersonaWorkerStore): Promise<number> {
  const worker = workerRefs.get(store);
  if (!worker) {
    throw new Error("PersonaWorkerStore has no registered worker reference");
  }
  return worker.terminate();
}

function deserializeStoreError(error: PersonaWorkerSerializedError): PersonaStoreError {
  return new PersonaStoreError(error.message, {
    code: error.code as PersonaStoreError["code"],
    dbPath: error.dbPath,
  });
}

function spawnPersonaWorker(options: PersonaStoreOptions): {
  worker: Worker;
  ready: Promise<void>;
} {
  const workerData = {
    dbPath: options.dbPath,
    lockWaitTimeoutMs: options.lockWaitTimeoutMs,
    adminRequestBudgetMs: options.adminRequestBudgetMs,
    receiptRetentionMs: options.receiptRetentionMs,
    receiptMaxPerAuthority: options.receiptMaxPerAuthority,
  };
  // 单一三元：打包态 define 把标识符替换成字符串字面量后，esbuild 常量折叠 true 分支、
  // tree-shake 掉 dist 文件分支（其中引用 import.meta.url——CJS bundle 里该语法会告警，
  // 折叠后警告与死代码一并消失）；tsc/dist 形态两分支都保留。
  const worker =
    typeof __DRORA_PERSONA_WORKER_SOURCE__ === "string"
      ? new Worker(__DRORA_PERSONA_WORKER_SOURCE__, { eval: true, workerData })
      : new Worker(resolveWorkerEntryUrl(), { workerData });
  const ready = new Promise<void>((resolve, reject) => {
    const settle = (settler: () => void): void => {
      cleanup();
      settler();
    };
    const onMessage = (raw: unknown): void => {
      const message = raw as PersonaWorkerResponse;
      if (message.kind === "ready") settle(() => resolve());
      else if (message.kind === "open-failed") {
        settle(() => reject(deserializeStoreError(message.error)));
      }
    };
    const onError = (error: Error): void => {
      settle(() =>
        reject(
          new PersonaStoreError(`Persona store worker failed during open: ${error.message}`, {
            code: PERSONA_ERROR_CODES.storageUnavailable,
            cause: error,
            dbPath: options.dbPath,
          }),
        ),
      );
    };
    const onExit = (code: number): void => {
      settle(() =>
        reject(
          new PersonaStoreError(`Persona store worker exited during open (exit code ${code})`, {
            code: PERSONA_ERROR_CODES.storageUnavailable,
            dbPath: options.dbPath,
          }),
        ),
      );
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
  });
  return { worker, ready };
}

function resolveWorkerEntryUrl(): URL {
  const here = new URL(".", import.meta.url);
  // worker 入口一律用构建期 esbuild 产物（persona-store-worker-main.bundle.cjs，CJS、
  // 已内联 @drora/shared 链）——纯 Node worker 不能加载 shared 的 TS 源导出，tsc 的
  // persona-store-worker-main.js 只作类型产物。源码形态（vitest 直接执行
  // src/storage/persona/*.ts）映射到同包 dist（src/storage/persona → 包根三级上跳）；
  // 编译产物形态取同目录兄弟文件。
  const entry = /(^|\/)src\/storage\/persona\/$/.test(here.href)
    ? new URL("../../../dist/storage/persona/persona-store-worker-main.bundle.cjs", here)
    : new URL("persona-store-worker-main.bundle.cjs", here);
  return entry;
}
