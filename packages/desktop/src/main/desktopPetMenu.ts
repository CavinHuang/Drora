import { Menu, shell, type BrowserWindow } from "electron";
import {
  DESKTOP_PET_BUILTINS,
  DESKTOP_PET_CONTRACT as C,
  type AppSettings,
  type Locale,
} from "@drora/shared";
import type { createDesktopPetLibrary } from "./desktopPetLibrary.js";

export async function showDesktopPetMenu(options: {
  window: BrowserWindow;
  isCurrent(): boolean;
  settings: Partial<AppSettings>;
  locale: Locale;
  library: ReturnType<typeof createDesktopPetLibrary>;
  toggleTray(): void;
  /** Mate 桌宠接缝（03 详设 §6）：「打开大副」经 Main→Renderer 导航端口直达；缺席不渲染。 */
  openMate?(): void;
  persist(patch: Partial<AppSettings>): Promise<void>;
  refresh(): Promise<void>;
  warn(error: unknown): void;
}) {
  const zh = options.locale.startsWith("zh");
  const library = await options.library.list();
  if (!options.isCurrent() || options.window.isDestroyed()) return;
  const act = (operation: () => Promise<unknown>) => () => {
    void operation().catch(options.warn);
  };
  const entries = [
    ...DESKTOP_PET_BUILTINS.map((item) => ({ id: item.id, label: zh ? item.nameZh : item.nameEn })),
    ...library.pets.map((item) => ({ id: item.id, label: item.displayName })),
  ];
  Menu.buildFromTemplate([
    // 排首：Mate 入口是接缝批新增的最高频动作（02 号 §7 /mate 直达同端口）。
    ...(options.openMate
      ? [{ label: zh ? "打开大副" : "Open Mate", click: () => options.openMate?.() }]
      : []),
    { label: zh ? "任务活动" : "Task activity", click: options.toggleTray },
    {
      label: zh ? "选择宠物" : "Choose pet",
      submenu: entries.map((entry) => ({
        label: entry.label,
        type: "radio" as const,
        checked: entry.id === (options.settings.desktopPetCharacter ?? "violet"),
        click: act(() => options.persist({ desktopPetCharacter: entry.id })),
      })),
    },
    {
      label: zh ? "重置大小" : "Reset size",
      click: act(() => options.persist({ desktopPetSize: C.defaultSize })),
    },
    { label: zh ? "刷新宠物" : "Refresh pets", click: act(options.refresh) },
    {
      label: zh ? "打开宠物文件夹" : "Open pet folder",
      click: act(async () => {
        const error = await shell.openPath(library.directoryPath);
        if (error) throw new Error(error);
      }),
    },
    { type: "separator" },
    {
      label: zh ? "隐藏宠物" : "Hide pet",
      click: act(() => options.persist({ desktopPetEnabled: false })),
    },
  ]).popup({ window: options.window });
}
