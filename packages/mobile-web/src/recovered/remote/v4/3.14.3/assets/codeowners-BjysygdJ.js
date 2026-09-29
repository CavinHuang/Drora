// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
var e = [
  Object.freeze(
    JSON.parse(
      `{"displayName":"CODEOWNERS","name":"codeowners","patterns":[{"include":"#comment"},{"include":"#pattern"},{"include":"#owner"}],"repository":{"comment":{"patterns":[{"begin":"^\\\\s*#","captures":{"0":{"name":"punctuation.definition.comment.codeowners"}},"end":"$","name":"comment.line.codeowners"}]},"owner":{"match":"\\\\S*@\\\\S+","name":"storage.type.function.codeowners"},"pattern":{"match":"^\\\\s*(\\\\S+)","name":"variable.other.codeowners"}},"scopeName":"text.codeowners"}`,
    ),
  ),
];
export { e as default };
