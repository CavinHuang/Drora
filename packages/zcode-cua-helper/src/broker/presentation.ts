var BROKER_PRESENTED_RESULT = Symbol("zcode.cua.broker-presented-result");
export function withBrokerPresentation(result, presentation) {
  return { [BROKER_PRESENTED_RESULT]: true, result, presentation };
}
export function isBrokerPresentedResult(value) {
  return typeof value === "object" && value !== null && value[BROKER_PRESENTED_RESULT] === true;
}
