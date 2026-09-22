export var UNPORTED_CODEX_STAGES = Object.freeze([
  "associateTitleUIElements",
  "flattenIntoSelectableAncestor",
  "pruneEmptyDisabledElements",
  "mergeSingleItemGroups",
  "flattenRepetitiveStaticText",
  "flattenLinksIntoMarkdownText",
]);
function hasNodeDescriptiveAttributes(node) {
  if (nonEmpty(node.title) || nonEmpty(node.description) || nonEmpty(node.value)) {
    return true;
  }
  return node.role === "AXImage";
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isInteractiveLike(node) {
  return (
    (node.actions?.length ?? 0) > 0 ||
    node.editable === true ||
    node.focused === true ||
    node.hasMenu === true
  );
}
function subtreeHasDescriptiveAttributes(node) {
  if (hasNodeDescriptiveAttributes(node)) return true;
  return (node.children ?? []).some(subtreeHasDescriptiveAttributes);
}
function subtreeHasInteractive(node) {
  if (isInteractiveLike(node)) return true;
  return (node.children ?? []).some(subtreeHasInteractive);
}
function isTextOnly(node) {
  return (
    node.role === "AXStaticText" && !isInteractiveLike(node) && (node.children ?? []).length === 0
  );
}
function isAbsorbableInteractiveShred(node) {
  return (
    (node.role === "AXButton" || node.role === "AXImage") &&
    !hasNodeDescriptiveAttributesExceptImageFallback(node) &&
    isInteractiveLike(node) &&
    (node.children ?? []).length === 0
  );
}
function hasNodeDescriptiveAttributesExceptImageFallback(node) {
  return nonEmpty(node.title) || nonEmpty(node.description) || nonEmpty(node.value);
}
function textRunSeparator(role) {
  if (role === "AXStaticText") return " ";
  if (role === "AXRadioButton" || role === "AXRow") return "; ";
  return " ";
}
function withChildren(node, children) {
  if (children && children.length > 0) return { ...node, children };
  const clone2 = { ...node };
  delete clone2.children;
  return clone2;
}
export function normalizeAxTree(roots) {
  let tree = roots.map((node) => ({ ...node, children: node.children?.slice() }));
  tree = pruneNonDescriptive(tree);
  tree = mergeTextOnlySiblings(tree);
  tree = flattenRedundantHierarchy(tree);
  tree = pruneNonDescriptive(tree);
  return tree;
}
function pruneNonDescriptive(nodes) {
  const out = [];
  for (const node of nodes) {
    const children = node.children ? pruneNonDescriptive(node.children) : void 0;
    const interactive = isInteractiveLike(node);
    const keep =
      interactive ||
      subtreeHasDescriptiveAttributes({ ...node, children }) || // codex 谓词链的兜底：子树内任一交互后代 → 保留（容器可能只是布局组）。
      (children ?? []).some(subtreeHasInteractive);
    if (!keep) continue;
    out.push(withChildren(node, children));
  }
  return out;
}
function mergeTextOnlySiblings(nodes) {
  const out = [];
  let run = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]);
    } else {
      const separator = textRunSeparator(run[0].role);
      const mergedTitle = run
        .map((n) => (isTextOnly(n) ? (n.title ?? n.value ?? "") : ""))
        .filter((part) => part.length > 0)
        .join(separator);
      out.push({ ...run[0], title: mergedTitle, value: null });
    }
    run = [];
  };
  for (const node of nodes) {
    if (isTextOnly(node) || isAbsorbableInteractiveShred(node)) {
      run.push(node);
      continue;
    }
    flushRun();
    out.push(
      withChildren(node, node.children?.length ? mergeTextOnlySiblings(node.children) : void 0),
    );
  }
  flushRun();
  return out;
}
function flattenRedundantHierarchy(nodes) {
  const out = [];
  for (const node of nodes) {
    let current = node;
    for (
      let guard = 0;
      guard < 16 &&
      !hasNodeDescriptiveAttributes(current) &&
      !isInteractiveLike(current) &&
      (current.children?.length ?? 0) === 1;
      guard += 1
    ) {
      current = current.children[0];
    }
    out.push(
      withChildren(
        current,
        current.children?.length ? flattenRedundantHierarchy(current.children) : void 0,
      ),
    );
  }
  return out;
}
