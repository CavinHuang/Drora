import assert from "node:assert/strict";
import test from "node:test";
import { createWebRemoteControlAutoStartGate } from "../src/lib/webRemoteControlAutoStart.js";

// 弹层自动开启闸门（spec: mobile-web-remote.md「Renderer 集成面」）：
// 每次弹层打开、每个传输至多自动开启一次。修复背景是跨传输共享单一布尔时，
// 默认 LAN 在打开时消耗唯一名额，切到“云中继”tab 后 relay 永远停在“未开启”。

test("idle 首次准许并占用该传输名额，重复请求拒绝", () => {
  const gate = createWebRemoteControlAutoStartGate();
  assert.equal(gate.admit({ status: "idle" }, "lan"), true);
  assert.equal(gate.admit({ status: "idle" }, "lan"), false);
});

test("LAN 与 relay 名额互不占用——切 tab 后 relay 仍可自动开启", () => {
  const gate = createWebRemoteControlAutoStartGate();
  assert.equal(gate.admit({ status: "idle" }, "lan"), true);
  assert.equal(gate.admit({ status: "idle" }, "relay"), true);
  assert.equal(gate.admit({ status: "idle" }, "relay"), false);
});

test("非 idle（服务已在运行/启动中/失败）或 state 缺失时不准许", () => {
  const gate = createWebRemoteControlAutoStartGate();
  assert.equal(gate.admit({ status: "running" }, "lan"), false);
  assert.equal(gate.admit({ status: "starting" }, "relay"), false);
  assert.equal(gate.admit({ status: "error" }, "relay"), false);
  // 平台未提供查询方法（如 Web）时 state 为 undefined，拒绝且不占名额。
  assert.equal(gate.admit(undefined, "lan"), false);
  assert.equal(gate.admit({ status: "idle" }, "lan"), true);
});

test("reset 清空名额（弹层关闭后再打开，各传输可再自动开启一次）", () => {
  const gate = createWebRemoteControlAutoStartGate();
  assert.equal(gate.admit({ status: "idle" }, "lan"), true);
  assert.equal(gate.admit({ status: "idle" }, "relay"), true);
  gate.reset();
  assert.equal(gate.admit({ status: "idle" }, "lan"), true);
  assert.equal(gate.admit({ status: "idle" }, "relay"), true);
});
