import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@drora/provider";
import { NodeDroraBuiltinProviderConfigSource } from "./drora-builtin-provider-config-source.js";
import {
  EndpointScopedDroraBuiltinSource,
  type EndpointScopedDroraBuiltinSourceOptions,
} from "./endpoint-scoped-drora-builtin-source.js";
import {
  DroraBuiltinRemoteSynchronizer,
  type DroraBuiltinRemoteSynchronizerOptions,
  type DroraBuiltinRefreshResult,
} from "./drora-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly droraBuiltinFilePath: string;
  readonly droraBuiltinActiveFilePath?: string;
  readonly droraBuiltinRemote?: Omit<DroraBuiltinRemoteSynchronizerOptions, "source">;
  readonly droraBuiltinEnvironment?: Omit<
    EndpointScopedDroraBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onDroraBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    droraBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 Drora Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #droraBuiltinSource:
    | NodeDroraBuiltinProviderConfigSource
    | EndpointScopedDroraBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: DroraBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#droraBuiltinSource = options.droraBuiltinEnvironment
      ? new EndpointScopedDroraBuiltinSource({
          bundledFilePath: options.droraBuiltinFilePath,
          ...options.droraBuiltinEnvironment,
        })
      : new NodeDroraBuiltinProviderConfigSource({
          bundledFilePath: options.droraBuiltinFilePath,
          activeFilePath: options.droraBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.droraBuiltinRemote &&
      this.#droraBuiltinSource instanceof NodeDroraBuiltinProviderConfigSource
        ? new DroraBuiltinRemoteSynchronizer({
            source: this.#droraBuiltinSource,
            ...options.droraBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onDroraBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#droraBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      droraBuiltinSource: this.#droraBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveDroraBuiltinActiveFilePath(): Promise<string> {
    return this.#droraBuiltinSource instanceof NodeDroraBuiltinProviderConfigSource
      ? Promise.resolve(this.#droraBuiltinSource.activeFilePath)
      : this.#droraBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@drora/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckDroraBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#droraBuiltinSource instanceof EndpointScopedDroraBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshDroraBuiltin(options?: { readonly force?: boolean }): Promise<DroraBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#droraBuiltinSource instanceof EndpointScopedDroraBuiltinSource) {
      return this.#droraBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshDroraBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#droraBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
