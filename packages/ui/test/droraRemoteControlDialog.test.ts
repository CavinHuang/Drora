// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  stop: vi.fn<() => Promise<void>>(),
  update: vi.fn<() => Promise<void>>(),
  toast: vi.fn(),
}));
vi.mock("../src/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ stopWebRemoteControl: ports.stop }),
}));
vi.mock("../src/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: { mobileRelayTransport: "lan" },
    loading: false,
    update: ports.update,
  }),
}));
vi.mock("../src/i18n/IntlProvider.js", () => ({ useDroraIntl: () => ({ locale: "en-US" }) }));
vi.mock("../src/components/ui/toast.js", () => ({ toast: ports.toast }));
vi.mock("../src/web-remote-control/WebRemoteControlDialog.js", async () => {
  const { createElement } = await import("react");
  return {
    WebRemoteControlDialog: ({ deploymentControls }: { deploymentControls: unknown }) =>
      createElement("div", null, deploymentControls as never),
  };
});
import { DroraRemoteControlDialog } from "../src/drora-extensions/RemoteControlDialog.js";

beforeEach(() => {
  vi.resetAllMocks();
  ports.stop.mockResolvedValue();
  ports.update.mockResolvedValue();
});
afterEach(cleanup);
it("stops the current official manager before persisting a different deployment", async () => {
  let finishStop!: () => void;
  ports.stop.mockReturnValue(
    new Promise((resolve) => {
      finishStop = resolve;
    }),
  );
  render(
    createElement(DroraRemoteControlDialog, {
      open: true,
      onOpenChange: vi.fn(),
      workspacePath: "/repo",
    }),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "relay" } });
  expect(ports.stop).toHaveBeenCalledOnce();
  expect(ports.update).not.toHaveBeenCalled();
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  finishStop();
  await waitFor(() => expect(ports.update).toHaveBeenCalledWith({ mobileRelayTransport: "relay" }));
});
it("a failed stop keeps the existing deployment and reports a recoverable error", async () => {
  ports.stop.mockRejectedValue(new Error("stop_failed"));
  render(
    createElement(DroraRemoteControlDialog, {
      open: true,
      onOpenChange: vi.fn(),
      workspacePath: "/repo",
    }),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "relay" } });
  await waitFor(() =>
    expect(ports.toast).toHaveBeenCalledWith("stop_failed", { variant: "warning" }),
  );
  expect(ports.update).not.toHaveBeenCalled();
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("lan");
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
});
