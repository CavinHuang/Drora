import type { DroraBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeDroraBackgroundTaskControlItems(
  current: readonly DroraBackgroundTaskControlItem[],
  updates: readonly DroraBackgroundTaskControlItem[],
): DroraBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
