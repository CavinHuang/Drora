# Agents Team

Use the `agents-team` skill to assemble and coordinate an agent team for this request:

$ARGUMENTS

Follow the staged protocol: first draft the member roster and the task DAG for review —
no member is spawned before the user approves the plan. After approval, delegate through
the shared task board (TeamTaskCreate/TeamTaskClaim/TeamTaskUpdate with attempt_id) and
communicate through TeamSendMessage; members report with source_task_id and
source_attempt_id. Keep the board as the single source of truth: results land on disk
with artifact references, messages stay short. Do not spawn more than the configured
member cap, and prefer sequential work unless a task is genuinely independent.
