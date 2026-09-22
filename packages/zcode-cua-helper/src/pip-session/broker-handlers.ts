import { z } from "zod";
import { BrokerError } from "../broker/types.js";
import {
  PIP_SESSION_PROTOCOL_VERSION,
  PIP_SESSION_RUNTIME_ID,
  pipSessionEventSchema,
} from "./contract.js";

var handshakeSchema = z
  .object({
    protocolVersion: z.number().int(),
    runtimeId: z.string(),
  })
  .strict();
var eventRequestSchema = z.object({ event: pipSessionEventSchema }).strict();
export function createPipSessionBrokerHandlers(options) {
  const assertRuntimeReady = () => {
    if (!options.runtimeReady) {
      throw new BrokerError(
        "version_mismatch",
        options.pipModeRequested === false
          ? "PiP session is not enabled on this Helper: it was launched without --pip-mode; Auto-PiP is disabled"
          : "PiP session native capability mismatch; Auto-PiP is disabled",
        {
          expectedProtocolVersion: PIP_SESSION_PROTOCOL_VERSION,
          expectedRuntimeId: PIP_SESSION_RUNTIME_ID,
          pipModeRequested: options.pipModeRequested !== false,
        },
      );
    }
  };
  return {
    pip_session_handshake: async (params) => {
      const request = handshakeSchema.parse(params);
      if (
        request.protocolVersion !== PIP_SESSION_PROTOCOL_VERSION ||
        request.runtimeId !== PIP_SESSION_RUNTIME_ID
      ) {
        throw new BrokerError(
          "version_mismatch",
          "PiP session protocol/runtime or native capability mismatch; Auto-PiP is disabled",
          {
            expectedProtocolVersion: PIP_SESSION_PROTOCOL_VERSION,
            expectedRuntimeId: PIP_SESSION_RUNTIME_ID,
          },
        );
      }
      assertRuntimeReady();
      return {
        ready: true,
        protocolVersion: PIP_SESSION_PROTOCOL_VERSION,
        runtimeId: PIP_SESSION_RUNTIME_ID,
      };
    },
    pip_session_event: async (params) => {
      assertRuntimeReady();
      const request = eventRequestSchema.parse(params);
      return options.coordinator.applyEvent(request.event);
    },
  };
}
