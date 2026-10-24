// D-G20-1 最小时序复现（分诊证据，不改产品代码）。
// 精确镜像三个生产文件的时序结构：
//   1) packages/ui/src/v4/vault/knowledge/usePreviousKnowledgeActions.ts:90-96/:135-139
//      —— onOpenNote 未 await（fire-and-forget）；isCurrent 闭包读
//         openingPreviousRef.current === token；finally 在 try 块同步结束后立即置空 token。
//   2) packages/ui/src/v4/VaultView.tsx:2108-2109
//      —— onOpenNote = (...) => { void openNoteFromKnowledge(...) }（不返回 Promise）。
//   3) packages/ui/src/v4/VaultView.tsx:1322-1376 openFile
//      —— :1338 第一次 isCurrent()（此刻 token 未清，通过）
//         :1339 await flushCurrentEditor()（async 函数，即使 editorFlushRef.current 为 null
//              返回 true，await 恢复也必须排入微任务队列 —— 必让出）
//         :1340 第二次 isCurrent()（此刻 finally 已同步执行完，token 已置 null）
//   4) packages/ui/src/v4/VaultView.tsx:1400-1444 openNoteFromKnowledge
//      —— opened 为 false 时提前 return，走不到 :1438 setBodyFocusRequest / :1439
//         setViewTab("notes")；readFile(:1351) 根本不会发出。
// 对照分支（CONTROL=1）：finally 延后到 onOpenNote 完成之后（产品修复方向之一，
// 即把 token 生命周期与 fire-and-forget 导航解耦），其余结构完全一致 → 应能打开。

const CONTROL = process.env.CONTROL === "1";

async function runOnce() {
  const openingPreviousRef = { current: null };
  let readFileCalls = 0;
  let notesTabActivated = false;
  let bailPoint = "";

  // VaultView.tsx:1120-1123 flushCurrentEditor（editorFlushRef.current 为 null → true）
  const flushCurrentEditor = async () => true;

  // VaultView.tsx:1322-1376 openFile（只保留时序相关的三次守卫与 readFile）
  const openFile = async (relativePath, { isCurrent }) => {
    if (isCurrent && !isCurrent()) {
      bailPoint = "bail-first-isCurrent"; // :1338
      return false;
    }
    if (!(await flushCurrentEditor())) return false; // :1339 必让出微任务
    if (isCurrent && !isCurrent()) {
      bailPoint = "bail-second-isCurrent"; // :1340
      return false;
    }
    readFileCalls++; // :1351 vaultService.readFile（守卫通过后才发生）
    return true;
  };

  // VaultView.tsx:1400-1444 openNoteFromKnowledge（:1438-1439 仅在 opened 后执行）
  const openNoteFromKnowledge = async (relativePath, isCurrent) => {
    const opened = await openFile(relativePath, { isCurrent });
    if (!opened) return false;
    notesTabActivated = true;
    return true;
  };

  // VaultView.tsx:2108-2109 onOpenNote（void，不传播 Promise）
  const onOpenNote = (relativePath, isCurrent) => {
    void openNoteFromKnowledge(relativePath, isCurrent);
  };

  // usePreviousKnowledgeActions.ts:64-143 runPreviousCandidateAction("open")
  const runPreviousCandidateAction = async () => {
    const token = { articleId: "a", seq: 1 };
    openingPreviousRef.current = token;
    try {
      // prepareEvidence/resolveCitation 已完成（proof.phase === "verified"）后的 open 分支。
      // 真实代码里此 await 已发生且不影响后续 token 时序语义，此处直接进入分支。
      const proof = { relativePath: "note.md" };
      onOpenNote(proof.relativePath, () => openingPreviousRef.current === token); // :90-96
    } finally {
      if (!CONTROL) {
        // :135-139 现状：finally 在未 await 的 onOpenNote 同步返回后立即清 token
        if (openingPreviousRef.current === token) openingPreviousRef.current = null;
      }
    }
    if (CONTROL) {
      // 对照：token 生命周期覆盖整个 fire-and-forget 导航（微任务 settle 后再清）
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (openingPreviousRef.current === token) openingPreviousRef.current = null;
    }
  };

  await runPreviousCandidateAction();
  await new Promise((resolve) => setTimeout(resolve, 50)); // 等全部微任务 settle
  return { readFileCalls, notesTabActivated, bailPoint: bailPoint || "none" };
}

const result = await runOnce();
console.log(
  `${CONTROL ? "control(fixed-lifecycle)" : "current-product-code"}: ` +
    `readFileCalls=${result.readFileCalls} notesTabActivated=${result.notesTabActivated} ` +
    `bail=${result.bailPoint}`,
);
