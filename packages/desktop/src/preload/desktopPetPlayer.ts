import type { DesktopPetConfiguration, DesktopPetSpriteFrame } from "@drora/shared";
import { petLookFrame } from "../shared/desktopPetAnimation.js";

const modes = {
  idle: "idle",
  working: "running",
  attention: "waiting",
  completed: "review",
  error: "failed",
} as const;

/** DOM animation owns no task state. Identical projections never restart a track. */
export function createDesktopPetPlayer(art: HTMLElement, changed: () => void) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let config: DesktopPetConfiguration | null = null;
  let image: HTMLImageElement | null = null;
  let alpha: Uint8ClampedArray | null = null;
  let mode: keyof typeof modes = "idle";
  let hover = false;
  let drag: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let greetingTimer: ReturnType<typeof setTimeout> | null = null;
  let greeting = false;
  let key = "";
  let generation = 0;
  let disposed = false;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const draw = (frame: DesktopPetSpriteFrame) => {
    if (!config || !image) return;
    art.style.backgroundPosition = `${config.columns <= 1 ? 0 : (frame.column / (config.columns - 1)) * 100}% ${config.rows <= 1 ? 0 : (frame.row / (config.rows - 1)) * 100}%`;
    art.dataset.row = String(frame.row);
    art.dataset.column = String(frame.column);
    if (context) {
      const width = image.naturalWidth / config.columns;
      const height = image.naturalHeight / config.rows;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        frame.column * width,
        frame.row * height,
        width,
        height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    changed();
  };
  const sync = () => {
    if (!config || !image || disposed) return;
    const state =
      drag ?? (hover ? "jumping" : greeting && mode === "idle" ? "waving" : modes[mode]);
    const look =
      !reduced.matches && !drag && ["idle", "running", "waving"].includes(state) && pointer
        ? petLookFrame(
            { x: 8, y: 8, width: config.width, height: config.height },
            pointer,
            config.spriteVersionNumber,
          )
        : null;
    const nextKey = `${state}:${reduced.matches}:${look ? `${look.row}:${look.column}` : "animation"}`;
    if (nextKey === key) return;
    key = nextKey;
    stop();
    art.dataset.state = state;
    if (look) {
      draw(look);
      return;
    }
    const track =
      config.tracks.find((track) => track.state === state) ??
      config.tracks.find((track) => track.state === "idle");
    if (!track?.frames.length) return;
    let index = 0;
    const animationKey = key;
    const tick = () => {
      if (disposed || !config || key !== animationKey) return;
      const frame = track.frames[index];
      if (!frame) return;
      draw(frame);
      if (key !== animationKey) return;
      if (reduced.matches) return;
      const next = index + 1 < track.frames.length ? index + 1 : track.loopStart;
      if (next == null) return;
      timer = setTimeout(() => {
        index = next;
        tick();
      }, frame.durationMs);
    };
    tick();
  };
  reduced.addEventListener("change", sync);
  return {
    async configure(value: DesktopPetConfiguration) {
      const token = ++generation;
      const loaded = new Image();
      loaded.src = value.image;
      try {
        await loaded.decode();
      } catch (error) {
        // 旧图集的异步失败可能晚于新图集成功；它不再拥有配置，不能破坏新图的命中状态。
        if (disposed || token !== generation) return false;
        throw error;
      }
      if (disposed || token !== generation) return false;
      // 解码成功后才替换图集，防止导入损坏图片时留下看不见却挡鼠标的窗口。
      const first = config == null;
      config = value;
      image = loaded;
      key = "";
      canvas.width = Math.round(loaded.naturalWidth / value.columns);
      canvas.height = Math.round(loaded.naturalHeight / value.rows);
      art.style.backgroundImage = `url("${value.image}")`;
      art.style.backgroundSize = `${value.columns * 100}% ${value.rows * 100}%`;
      art.dataset.petId = value.id;
      if (first && mode === "idle") {
        const wave = value.tracks.find((track) => track.state === "waving");
        const duration =
          wave?.frames
            .slice(0, wave.loopStart ?? wave.frames.length)
            .reduce((sum, frame) => sum + frame.durationMs, 0) ?? 0;
        greeting = duration > 0;
        greetingTimer = setTimeout(() => {
          greeting = false;
          sync();
        }, duration);
      }
      sync();
      return true;
    },
    setMode(value: keyof typeof modes) {
      mode = value;
      if (value !== "idle") greeting = false;
      sync();
    },
    setHover(value: boolean) {
      hover = value;
      sync();
    },
    setDrag(value: string | null) {
      drag = value;
      sync();
    },
    setPointer(value: { x: number; y: number }) {
      pointer = value;
      sync();
    },
    hit(point: { x: number; y: number }): boolean {
      if (!config || !alpha) return false;
      const x = Math.floor(((point.x - 8) / config.width) * canvas.width);
      const y = Math.floor(((point.y - 8) / config.height) * canvas.height);
      return (
        x >= 0 &&
        y >= 0 &&
        x < canvas.width &&
        y < canvas.height &&
        (alpha[(y * canvas.width + x) * 4 + 3] ?? 0) > 8
      );
    },
    dispose() {
      disposed = true;
      generation++;
      stop();
      if (greetingTimer) clearTimeout(greetingTimer);
      reduced.removeEventListener("change", sync);
    },
  };
}
