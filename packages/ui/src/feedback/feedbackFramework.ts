import {
  DEFAULT_FEEDBACK_TICKET_FRAMEWORK,
  type DroraProvider,
  type FeedbackTicketFramework,
} from "@drora/shared";

export function inferFeedbackFrameworkFromAgentProvider(
  _provider: DroraProvider | null | undefined,
): FeedbackTicketFramework {
  return DEFAULT_FEEDBACK_TICKET_FRAMEWORK;
}
