# Agents Team

Use the `agents-team` skill to assemble and coordinate an agent team for this request:

$ARGUMENTS

Follow the staged protocol: call `TeamSpawn` once with the full member roster and the
task DAG (each task carries title, goal, acceptance, optional assignee and depends_on)
— no member is spawned before the user reviews and approves the plan. Re-call TeamSpawn
(pass each task's task_id to keep identity) to revise the same draft. After approval,
delegate through the shared task board (TeamTaskCreate/TeamTaskClaim/TeamTaskUpdate with
attempt_id) and communicate through TeamSendMessage; members report with source_task_id
and source_attempt_id. Keep the board as the single source of truth: results land on disk
with artifact references, messages stay short. Do not spawn more than the configured
member cap, and prefer sequential work unless a task is genuinely independent.
