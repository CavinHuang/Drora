import { useDroraStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useDroraStoreWithDefault((state) => state.interfaceMode === "office", false);
}
