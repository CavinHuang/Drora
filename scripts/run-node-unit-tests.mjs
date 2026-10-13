import { spawn } from "node:child_process";
import { discoverNodeUnitTestFiles } from "./node-unit-test-files.mjs";

const files = discoverNodeUnitTestFiles();
if (!files.length) throw new Error("No Node unit test files found");
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=2", ...files],
  {
    stdio: "inherit",
    env: process.env,
  },
);
child.on("error", (error) => {
  throw error;
});
child.on("exit", (code, signal) => {
  if (signal) throw new Error(`Node tests terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
