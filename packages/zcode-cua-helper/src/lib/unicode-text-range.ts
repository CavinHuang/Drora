function splitsUtf16SurrogatePair(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 55296 && before <= 56319 && after >= 56320 && after <= 57343;
}
export function textRangeSplitsUtf16SurrogatePair(text, range) {
  const [start, length] = range;
  return splitsUtf16SurrogatePair(text, start) || splitsUtf16SurrogatePair(text, start + length);
}
