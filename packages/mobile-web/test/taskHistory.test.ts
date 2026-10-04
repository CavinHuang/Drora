import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { TaskSession, type TaskSessionTarget } from "../src/app/taskSession.js";
import type { ConversationStore } from "../src/app/conversationStore.js";

const row = (rowId: number) => ({ rowId }) as ConversationRow;

function makeSession(
  query: (beforeRowId: number) => Promise<{
    rows: ConversationRow[];
    atSeq: number;
    atLogEpoch: string;
    hasMore: boolean;
  }>,
) {
  let rows = [row(3), row(4)];
  let epoch = "epoch-1";
  let seq = 8;
  const snapshot = { rows: { window: rows, totalCount: 4, firstRowId: 1 } } as ConversationSnapshot;
  const store = {
    getRows: () => rows,
    getState: () => ({ snapshot, seq, logEpoch: epoch, subscriptionId: "sub-1", ready: true }),
    replaceRows(next: ConversationRow[], atSeq: number, atLogEpoch: string) {
      if (atLogEpoch !== epoch || atSeq > seq) return false;
      rows = next;
      snapshot.rows.window = next;
      return true;
    },
  } as unknown as ConversationStore;
  const accessor = {
    zcodeAgentService: {
      conversationRowsRangeV4: ({ beforeRowId }: { beforeRowId: number }) => query(beforeRowId),
    },
  };
  const Ctor = TaskSession as unknown as new (
    accessor: unknown,
    target: TaskSessionTarget,
    client: null,
    bridgeSessionId: string,
    store: ConversationStore,
    frameSubscription: null,
  ) => TaskSession;
  const session = new Ctor(
    accessor,
    { workspacePath: "C:/ws", sessionId: "s1" },
    null,
    "b1",
    store,
    null,
  );
  return {
    session,
    rows: () => rows,
    setEpoch: (next: string) => {
      epoch = next;
    },
    setSeq: (next: number) => {
      seq = next;
    },
  };
}

test("向上分页用当前首行作游标，前插后到达全序首行", async () => {
  const cursors: number[] = [];
  const { session, rows } = makeSession(async (beforeRowId) => {
    cursors.push(beforeRowId);
    return { rows: [row(1), row(2)], atSeq: 8, atLogEpoch: "epoch-1", hasMore: false };
  });
  assert.equal(session.canLoadOlder, true);
  await session.loadOlder();
  assert.deepEqual(cursors, [3]);
  assert.deepEqual(
    rows().map((value) => value.rowId),
    [1, 2, 3, 4],
  );
  assert.equal(session.canLoadOlder, false);
});

test("同游标并发请求合并；跨纪元迟到结果不前插", async () => {
  let complete:
    | ((result: {
        rows: ConversationRow[];
        atSeq: number;
        atLogEpoch: string;
        hasMore: boolean;
      }) => void)
    | null = null;
  let calls = 0;
  const { session, rows, setEpoch } = makeSession(() => {
    calls += 1;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const first = session.loadOlder();
  const second = session.loadOlder();
  assert.equal(calls, 1);
  setEpoch("epoch-2");
  complete?.({ rows: [row(1), row(2)], atSeq: 8, atLogEpoch: "epoch-1", hasMore: false });
  await Promise.all([first, second]);
  assert.deepEqual(
    rows().map((value) => value.rowId),
    [3, 4],
  );
});
