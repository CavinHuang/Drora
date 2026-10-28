# Agents Team

Use the `agents-team` skill to assemble and coordinate an agent team for this request:

$ARGUMENTS

Follow the staged protocol: call `TeamSpawn` once with a **manager**, the member roster,
and the task DAG (each task carries title, goal, acceptance, optional assignee and
depends_on) — no one is spawned before the user reviews and approves the plan. The team
structure starts with the manager: name a manager yourself first. The manager coordinates
tasks, consumes member reports, reassigns stalled work, and delivers exactly one final
report to the lead; workers never message the lead. Re-call TeamSpawn (pass each task's
task_id to keep identity) to revise the same draft. After approval, work flows through the
shared task board (TeamTaskCreate/TeamTaskClaim/TeamTaskUpdate with attempt_id); workers
report to the manager via TeamSendMessage with source_task_id and source_attempt_id. Keep
the board as the single source of truth: results land on disk with artifact references,
messages stay short. Do not spawn more than the configured member cap, and prefer
sequential work unless a task is genuinely independent.
