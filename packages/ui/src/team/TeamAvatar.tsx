import { BotIcon } from "lucide-react";
import { avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";

export function TeamAvatar({ name, color }: { name: string; color?: string }) {
  const literal = color?.startsWith("#") || color?.startsWith("rgb") ? color : undefined;
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md text-white ${literal ? "" : (color ?? "")}`}
      style={{ backgroundColor: literal ?? (color ? undefined : avatarColor(name)) }}
    >
      <BotIcon className="size-3.5" />
    </span>
  );
}
