import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const trayInstances: Array<{
    imageAtCreate: string;
    images: unknown[];
    tooltips: string[];
  }> = [];
  // 上游 v3.17.1：托盘合成改为 createEmpty + addRepresentation（1x/2x 双表示），
  // 这里记录每次 addRepresentation 的入参以断言几何与缓存行为。
  const representationCalls: Array<{
    scaleFactor: number;
    width: number;
    height: number;
    buffer: Buffer;
  }> = [];
  let baseImageCounter = 0;

  // 指定边长的不透明蓝底（预乘 BGRA），模拟托盘底图；resize 后的 toBitmap
  // 必须与请求尺寸一致，否则会触发生产代码的位深防御而放弃合成。
  const blueBuffer = (size: number): Buffer => {
    const buffer = Buffer.alloc(size * size * 4);
    for (let offset = 0; offset < buffer.length; offset += 4) {
      buffer[offset] = 200;
      buffer[offset + 1] = 40;
      buffer[offset + 2] = 10;
      buffer[offset + 3] = 255;
    }
    return buffer;
  };
  const baseBuffer = blueBuffer(32);

  const fakeBaseImage = () => ({
    __baseImage: ++baseImageCounter,
    isEmpty: () => false,
    resize: ({ width }: { width: number; height: number }) => ({
      toBitmap: () => blueBuffer(width),
    }),
  });

  return {
    trayInstances,
    representationCalls,
    baseBuffer,
    fakeBaseImage,
    resetBaseImageCounter: () => {
      baseImageCounter = 0;
    },
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: false },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
  Tray: class {
    images: unknown[] = [];
    tooltips: string[] = [];
    constructor(imagePath: string) {
      state.trayInstances.push({
        imageAtCreate: imagePath,
        images: this.images,
        tooltips: this.tooltips,
      });
    }
    setImage(image: unknown) {
      this.images.push(image);
    }
    setToolTip(tooltip: string) {
      this.tooltips.push(tooltip);
    }
    setContextMenu() {}
    on() {}
  },
  nativeImage: {
    createFromPath: () => state.fakeBaseImage(),
    createEmpty: () => ({
      __composed: state.representationCalls.length + 1,
      addRepresentation(representation: {
        scaleFactor: number;
        width: number;
        height: number;
        buffer: Buffer;
      }) {
        state.representationCalls.push(representation);
      },
    }),
  },
}));

describe("desktop tray unread badge", () => {
  beforeEach(() => {
    vi.resetModules();
    state.trayInstances.length = 0;
    state.representationCalls.length = 0;
    state.resetBaseImageCounter();
  });

  async function loadModule() {
    return import("../src/main/desktopTray.js");
  }

  const trayOptions = {
    getLocale: () => "zh-CN" as const,
    showCurrentWindow: () => {},
    executeDesktopCommand: async () => {},
    quitApp: () => {},
    logger: { warn: vi.fn() },
  };

  function pixelOf(buffer: Buffer, x: number, y: number, size = 32): number[] {
    const offset = (y * size + x) * 4;
    return [buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!];
  }

  it("没有托盘时 no-op 不抛错", async () => {
    const { applyDesktopTrayUnreadBadge } = await loadModule();

    expect(() => applyDesktopTrayUnreadBadge(3)).not.toThrow();
    expect(state.trayInstances).toHaveLength(0);
  });

  it("计数非零时按 1x/2x 双表示合成右上红点，按 label 缓存", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "win32" });
    expect(state.trayInstances).toHaveLength(1);

    mod.applyDesktopTrayUnreadBadge(3);
    mod.applyDesktopTrayUnreadBadge(3);

    // 同一 label 只合成一次：一次 createEmpty 携带 1x 与 2x 两个表示
    expect(state.representationCalls).toHaveLength(2);
    // 创建时 + 两次换图
    const images = state.trayInstances[0]!.images;
    expect(images).toHaveLength(2);

    expect(state.representationCalls[0]!).toMatchObject({
      scaleFactor: 1,
      width: 16,
      height: 16,
    });
    expect(state.representationCalls[1]!).toMatchObject({
      scaleFactor: 2,
      width: 32,
      height: 32,
    });
    const oneX = state.representationCalls[0]!.buffer;
    const twoX = state.representationCalls[1]!.buffer;
    expect(oneX.length).toBe(16 * 16 * 4);
    expect(twoX.length).toBe(32 * 32 * 4);
    // 2x 表示：红点 origin(22,0)+圆心(5.5,4.5)、radius 3.75；(27,4) 距圆心 0.71，
    // 超采样全覆盖 → 纯红预乘像素（B=53,G=57,R=229）。
    expect(pixelOf(twoX, 27, 4)).toEqual([53, 57, 229, 255]);
    // 1x 表示：origin(11,0)+圆心(2.75,2.25)、radius 1.875；(14,2) 距圆心 0.35，全覆盖。
    expect(pixelOf(oneX, 14, 2, 16)).toEqual([53, 57, 229, 255]);
    // Logo 本体保持蓝色
    expect(pixelOf(twoX, 16, 16)).toEqual([200, 40, 10, 255]);
    expect(pixelOf(twoX, 8, 24)).toEqual([200, 40, 10, 255]);
    // 两个表示都不应出现白色笔画像素
    for (const buffer of [oneX, twoX]) {
      let hasWhitePixel = false;
      for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
        if (
          buffer[offset] === 255 &&
          buffer[offset + 1] === 255 &&
          buffer[offset + 2] === 255 &&
          buffer[offset + 3] === 255
        ) {
          hasWhitePixel = true;
          break;
        }
      }
      expect(hasWhitePixel).toBe(false);
    }
  });

  it("计数归零时恢复原始托盘底图", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "win32" });

    mod.applyDesktopTrayUnreadBadge(3);
    mod.applyDesktopTrayUnreadBadge(0);

    const images = state.trayInstances[0]!.images;
    expect(images).toHaveLength(2);
    // 恢复的图就是 createFromPath 返回的底图对象本身
    expect(images[1]).toMatchObject({ __baseImage: 1 });
  });

  it("linux 平台托盘同样生效", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "linux" });

    mod.applyDesktopTrayUnreadBadge(1);

    expect(state.representationCalls).toHaveLength(2);
  });
});
