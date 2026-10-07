import {
  collectVisibleDroraBackgroundTaskControlItems,
  getDroraBackgroundTaskControlItemElapsedMs,
  isActiveDroraBackgroundTaskControlItem,
  parseDroraBackgroundTaskControlItems,
  type DroraBackgroundTaskControlItem,
  type DroraBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type DroraBackgroundBashJobStatus = DroraBackgroundTaskControlStatus;
export type DroraBackgroundBashJob = DroraBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseDroraBackgroundBashJobs(value: unknown): DroraBackgroundBashJob[] {
  return parseDroraBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveDroraBackgroundBashJob(job: DroraBackgroundBashJob): boolean {
  return isActiveDroraBackgroundTaskControlItem(job);
}

export function getDroraBackgroundBashJobElapsedMs(
  job: DroraBackgroundBashJob,
  now = Date.now(),
): number {
  return getDroraBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleDroraBackgroundBashJobs(
  jobs: readonly DroraBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<DroraBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleDroraBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    DroraBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: DroraBackgroundTaskControlItem): job is DroraBackgroundBashJob {
  return job.taskKind === "bash";
}
