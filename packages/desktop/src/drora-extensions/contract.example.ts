import type { RemoteDeploymentPort } from "./contract.js";
export const example: RemoteDeploymentPort = {
  getEndpointUrls: async () => {
    throw new Error("Supply deployment endpoints");
  },
  resolveAuthStorageProvider: () => ({
    load: async () => undefined,
    save: async () => {},
    clear: async () => {},
    rotate: async () => {},
  }),
  dispose: async () => {},
};
