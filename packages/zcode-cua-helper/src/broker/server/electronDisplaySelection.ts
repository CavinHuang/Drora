// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// Electron 多显示器选择逻辑（纯函数，display 集合由调用方注入）。

import { BrokerError } from "../types.js";

function createElectronDisplaySelection(source) {
  let selectedDisplayId;
  const topology = () => {
    const displays = source.getAllDisplays();
    const primaryId = source.getPrimaryDisplay().id;
    return {
      displays: [
        ...displays.filter((display) => display.id === primaryId),
        ...displays.filter((display) => display.id !== primaryId),
      ],
      primaryId,
    };
  };
  const ordered = () => topology().displays;
  const status = () => {
    const { displays } = topology();
    const position =
      selectedDisplayId === void 0
        ? -1
        : displays.findIndex((display) => display.id === selectedDisplayId);
    return {
      displays,
      selectedIndex: selectedDisplayId === void 0 || position === -1 ? null : position + 1,
    };
  };
  const snapshot = () => {
    const { displays } = topology();
    const position =
      selectedDisplayId === void 0
        ? 0
        : displays.findIndex((display2) => display2.id === selectedDisplayId);
    const display = displays[position];
    if (!display) {
      throw new BrokerError(
        "invalid_request",
        selectedDisplayId === void 0
          ? "No display is currently available."
          : `Selected display id ${selectedDisplayId} is no longer available; call list_displays and set_display again.`,
      );
    }
    return {
      displays,
      current: display,
      currentIndex: position + 1,
      selectedIndex: selectedDisplayId === void 0 ? null : position + 1,
    };
  };
  const snapshotForId = (displayId) => {
    const { displays, primaryId } = topology();
    const requestedId = displayId === null || displayId === void 0 ? primaryId : displayId;
    if (typeof requestedId !== "number" || !Number.isInteger(requestedId)) {
      throw new BrokerError(
        "invalid_request",
        `screenshot display_id must be an integer or null (got ${String(displayId)}).`,
      );
    }
    const position = displays.findIndex((display2) => display2.id === requestedId);
    const display = displays[position];
    if (!display) {
      throw new BrokerError(
        "invalid_request",
        `Selected display id ${requestedId} is no longer available; call list_displays and switch_display again.`,
      );
    }
    return {
      displays,
      current: display,
      currentIndex: position + 1,
      selectedIndex: displayId === null || displayId === void 0 ? null : position + 1,
    };
  };
  return {
    topology,
    status,
    ordered,
    snapshot,
    snapshotForId,
    current: () => snapshot().current,
    select: (index) => {
      const { displays } = topology();
      const displayCount = displays.length;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        index < 1 ||
        index > displayCount
      ) {
        throw new BrokerError(
          "invalid_request",
          `set_display index must be an integer from 1 to ${displayCount}.`,
        );
      }
      selectedDisplayId = displays[index - 1].id;
    },
    selectedIndex: () => {
      return status().selectedIndex;
    },
  };
}
