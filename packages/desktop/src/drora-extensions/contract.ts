/** Drora 发行源装配端口；更新状态仍由官方 updater 持有。 */
export interface DroraUpdateFeedTarget {
  setFeedURL(options: { provider: "generic"; url: string }): void;
}
