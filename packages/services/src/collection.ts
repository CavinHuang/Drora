import { ProxyChannel, type IChannelServer } from "@drora/rpc";
import { toOfficialRpcChannelAlias } from "@drora/shared";
import type { ServiceDescriptor } from "./descriptors.js";

/**
 * ServiceCollection — 服务注册中心
 *
 * 服务端用来注册服务实例，并自动暴露到 ChannelServer。
 */
export class ServiceCollection {
  private readonly _services = new Map<string, unknown>();

  register<T>(descriptor: ServiceDescriptor<T>, instance: T): this {
    this._services.set(descriptor.channelName, instance);
    return this;
  }

  get<T>(descriptor: ServiceDescriptor<T>): T {
    const instance = this._services.get(descriptor.channelName);
    if (!instance) {
      throw new Error(`Service not registered: ${descriptor.channelName}`);
    }
    return instance as T;
  }

  getOptional<T>(descriptor: ServiceDescriptor<T>): T | undefined {
    return this._services.get(descriptor.channelName) as T | undefined;
  }

  /** 将所有已注册的服务自动暴露为 channel */
  exposeOnChannelServer(
    server: IChannelServer,
    overrides: ReadonlyMap<string, unknown> = new Map(),
    options?: {
      /**
       * 同时注册官方通道名别名（zcode-* → 同一 channel 实例）。
       * 仅用于 web-remote-replayable 附着：官方托管手机页按官方名调用服务
       * （M4b 兼容桥，spec: mobile-web-remote.md）。
       */
      officialChannelAliases?: boolean;
    },
  ): void {
    for (const [channelName, instance] of this._services) {
      const exposed = overrides.get(channelName) ?? instance;
      const channel = ProxyChannel.fromService(exposed as Record<string, unknown>);
      server.registerChannel(channelName, channel);
      if (options?.officialChannelAliases) {
        const alias = toOfficialRpcChannelAlias(channelName);
        if (alias) server.registerChannel(alias, channel);
      }
    }
    // overrides 里可能存在不在 _services 注册表的覆盖键（如 window-controller 的
    // attachment 变体）；官方别名同样需要指向覆盖后的实现。
    if (options?.officialChannelAliases) {
      for (const [channelName, instance] of overrides) {
        if (this._services.has(channelName)) continue;
        const alias = toOfficialRpcChannelAlias(channelName);
        if (alias) {
          server.registerChannel(alias, ProxyChannel.fromService(instance as Record<string, unknown>));
        }
      }
    }
  }
}
