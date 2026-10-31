/**
 * persona 库事务运行器（cli-persona-store 内部模块）：P0/P1a 管理事务与 P1b 学习事务
 * 共享同一 node:sqlite 连接，必须共享同一个进程内队列——单连接上重叠的 begin 会报
 * errcode 1「cannot start a transaction within a transaction」，而 toStoreError 对
 * errcode 1 只能归类为 storage_unavailable，会把内部串行化缺陷伪装成环境故障。
 * 语义与拆分前完全一致（合同 §2：管理请求总预算、BUSY 退避、写超预算 outcome_unknown）。
 */
import type { DatabaseSync } from "node:sqlite";
import { PERSONA_ERROR_CODES } from "@drora/shared";
import { PersonaStoreError } from "./contract.js";
import type { StoreOutcome } from "./persona-rows.js";
import { isSqliteBusyError, sleep, toPersonaStoreError } from "./persona-store-errors.js";

const BUSY_RETRY_INITIAL_DELAY_MS = 10;
const BUSY_RETRY_MAX_DELAY_MS = 200;

export class PersonaSqliteTxnRunner {
  private txnQueue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly dbPath: string,
    private readonly adminRequestBudgetMs: number,
  ) {}

  markClosed(): void {
    this.closed = true;
  }

  /** 打开/迁移阶段的预算内重试（按读分类：迁移要么已回滚要么已提交，不存在未知结局）。 */
  async acquireDuringOpen<T>(operation: () => T): Promise<T> {
    return this.acquire(Date.now() + this.adminRequestBudgetMs, operation);
  }

  /** 打开/迁移阶段的错误分类（按读；写侧 outcome_unknown 只适用于业务写事务）。 */
  toOpenError(error: unknown): PersonaStoreError {
    return toPersonaStoreError(error, { write: false, dbPath: this.dbPath });
  }

  /** 队列互斥：入队等前序事务落定后再开跑；队列自身不会 reject。 */
  async withTxn<T>(write: boolean, fn: () => StoreOutcome<T>): Promise<StoreOutcome<T>> {
    const outcome = this.txnQueue.then(() => this.runTxn(write, fn));
    this.txnQueue = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  }

  private async runTxn<T>(write: boolean, fn: () => StoreOutcome<T>): Promise<StoreOutcome<T>> {
    this.assertOpen();
    const deadline = Date.now() + this.adminRequestBudgetMs;
    try {
      await this.acquire(deadline, () =>
        this.db.exec(write ? "begin immediate" : "begin deferred"),
      );
    } catch (error) {
      throw this.toStoreError(error, write);
    }
    try {
      const outcome = fn();
      if (outcome.kind === "value") {
        // WAL 下提交也可能与并发写者撞忙；同一预算内重试，超时按写请求表达 outcome_unknown。
        await this.acquire(deadline, () => this.db.exec("commit"));
      } else if (this.db.isTransaction) {
        this.db.exec("rollback");
      }
      return outcome;
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec("rollback");
        } catch {
          /* 保留首个错误。 */
        }
      }
      throw this.toStoreError(error, write);
    }
  }

  /** 预算内对 BUSY 做退避重试；预算耗尽把最后一个 BUSY 交给调用方按读/写分类。 */
  private async acquire<T>(deadline: number, operation: () => T): Promise<T> {
    let delay = BUSY_RETRY_INITIAL_DELAY_MS;
    for (;;) {
      try {
        return operation();
      } catch (error) {
        if (!isSqliteBusyError(error)) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        await sleep(Math.min(delay, remaining));
        delay = Math.min(BUSY_RETRY_MAX_DELAY_MS, delay * 2);
      }
    }
  }

  private toStoreError(error: unknown, write: boolean): PersonaStoreError {
    return toPersonaStoreError(error, { write, dbPath: this.dbPath });
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) {
      throw new PersonaStoreError("Persona store is closed", {
        code: PERSONA_ERROR_CODES.storageUnavailable,
        dbPath: this.dbPath,
      });
    }
  }
}
