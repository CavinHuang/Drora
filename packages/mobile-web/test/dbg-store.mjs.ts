import {
  TopicWireFrameAssembler,
  conversationTopicFrameSchema,
  V4_WIRE_PROTOCOL_VERSION,
  type ConversationSnapshot,
  type ConversationTopicFrame,
} from "@zcode/shared/zcode-protocol-v4";

const TOPIC = "conversation/sess-store";
const snapshot: ConversationSnapshot = {
  protocolVersion: 1,
  sessionId: "sess-store",
  logEpoch: "epoch-1",
  seq: 5,
  revision: 1,
  control: {
    phase: "running",
    sessionEnded: false,
    canStop: false,
    stopState: "idle",
    stopTargetKind: "unknown",
    activeWorks: [],
    lastError: null,
    apiRetry: null,
  },
  availability: {
    fork: { allowed: true },
    compact: { allowed: true },
    switchModelConfig: { allowed: true },
    setFollowupMode: { allowed: true },
    queueEdit: { allowed: true },
    sendQueuedNow: { allowed: true },
  },
  inputRouting: { mode: "startNow" },
  config: { provider: "p", model: "m", thought: "t", followupMode: "queue" },
  usage: {
    contextWindow: null,
    cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  queue: { items: [], autoDrain: true },
  pendingInteractions: [],
  pendingCommands: [],
  backgroundWorks: [],
  goal: null,
  plan: null,
  rows: { window: [], totalCount: 0, firstRowId: null },
};
const logicalFrame = {
  topic: TOPIC,
  subscriptionId: "sub-1",
  fromSeq: 0,
  toSeq: 5,
  sentAt: 1,
  payload: { kind: "snapshot" as const, snapshot },
};
const parse = conversationTopicFrameSchema.safeParse(logicalFrame);
console.log("logical parse ok:", parse.success);
if (!parse.success) console.log(parse.error.issues.slice(0, 3));
const wire = {
  wireVersion: V4_WIRE_PROTOCOL_VERSION,
  kind: "complete" as const,
  deliveryKind: "initial" as const,
  logicalFrameId: "lf-1",
  logicalFrameOrdinal: 1,
  topic: TOPIC,
  subscriptionId: "sub-1",
  frame: logicalFrame,
};
const asm = new TopicWireFrameAssembler<ConversationTopicFrame>(conversationTopicFrameSchema);
const events = asm.accept(wire as never);
console.log(
  "events:",
  JSON.stringify(events, (k, v) => (k === "frame" ? "[frame]" : v)).slice(0, 800),
);
