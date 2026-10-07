import type { ProviderConfigLayerSnapshot, ProviderSource } from "@drora/provider";
import {
  normalizeDroraBuiltinEndpointOrigin,
  resolveDroraBuiltinCachePaths,
} from "./drora-builtin-cache-paths.js";
import { NodeDroraBuiltinProviderConfigSource } from "./drora-builtin-provider-config-source.js";
import {
  DroraBuiltinRemoteSynchronizer,
  type DroraBuiltinRefreshResult,
  type DroraBuiltinRemoteSynchronizerOptions,
} from "./drora-builtin-remote-synchronizer.js";

export interface EndpointScopedDroraBuiltinSourceOptions {
  readonly bundledFilePath: string;
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly resolveEndpointOrigin: () => string | Promise<string>;
  readonly fetchRelease: DroraBuiltinRemoteSynchronizerOptions["fetchRelease"];
  readonly onRefreshResult?: DroraBuiltinRemoteSynchronizerOptions["onRefreshResult"];
  readonly watch?: boolean;
}

/**
 * 让 Environment 的 Drora 控制面 Endpoint 同时决定 Active/LKG 与刷新控制路径。
 * Endpoint 切换只替换当前 Source，不读取上一 Endpoint 的缓存。
 */
export class EndpointScopedDroraBuiltinSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #options: EndpointScopedDroraBuiltinSourceOptions;
  readonly #listeners = new Set<(reason: string) => void>();
  #current: CurrentEndpointSource | null = null;
  #ensureInFlight: Promise<CurrentEndpointSource> | null = null;
  #disposed = false;

  constructor(options: EndpointScopedDroraBuiltinSourceOptions) {
    this.#options = options;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    return (await this.#ensureCurrent()).source.read();
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(options?: { readonly force?: boolean }): Promise<DroraBuiltinRefreshResult> {
    return (await this.#ensureCurrent()).synchronizer.refresh(options);
  }

  /** 返回当前 Environment Endpoint 对应、已完成物化的 Active Config 路径。 */
  async resolveActiveFilePath(): Promise<string> {
    return (await this.#ensureCurrent()).activeFilePath;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#current?.dispose();
    this.#current = null;
    this.#listeners.clear();
  }

  async #ensureCurrent(): Promise<CurrentEndpointSource> {
    this.#assertNotDisposed();
    if (this.#ensureInFlight) return this.#ensureInFlight;
    const ensure = this.#resolveCurrent().finally(() => {
      if (this.#ensureInFlight === ensure) this.#ensureInFlight = null;
    });
    this.#ensureInFlight = ensure;
    return ensure;
  }

  async #resolveCurrent(): Promise<CurrentEndpointSource> {
    const endpointOrigin = normalizeDroraBuiltinEndpointOrigin(
      await this.#options.resolveEndpointOrigin(),
    );
    const paths = resolveDroraBuiltinCachePaths({
      environmentConfigRoot: this.#options.environmentConfigRoot,
      platform: this.#options.platform,
      appVersion: this.#options.appVersion,
      droraEndpointOrigin: endpointOrigin,
    });
    if (this.#current?.activeFilePath === paths.activeFilePath) return this.#current;

    const source = new NodeDroraBuiltinProviderConfigSource({
      bundledFilePath: this.#options.bundledFilePath,
      activeFilePath: paths.activeFilePath,
      watch: this.#options.watch,
    });
    const sourceDispose = source.onDidChange((reason) => this.#emit(reason));
    const synchronizer = new DroraBuiltinRemoteSynchronizer({
      source,
      controlFilePath: paths.controlFilePath,
      resolveEndpointKey: async () =>
        normalizeDroraBuiltinEndpointOrigin(await this.#options.resolveEndpointOrigin()),
      fetchRelease: this.#options.fetchRelease,
      onRefreshResult: this.#options.onRefreshResult,
    });
    try {
      await source.read();
      this.#assertNotDisposed();
    } catch (error) {
      sourceDispose();
      synchronizer.dispose();
      source.dispose();
      throw error;
    }

    const previous = this.#current;
    const current = new CurrentEndpointSource(
      paths.activeFilePath,
      source,
      synchronizer,
      sourceDispose,
    );
    this.#current = current;
    previous?.dispose();
    if (previous) this.#emit("endpoint-changed");
    return current;
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("EndpointScopedDroraBuiltinSource 已 dispose");
  }
}

class CurrentEndpointSource {
  constructor(
    readonly activeFilePath: string,
    readonly source: NodeDroraBuiltinProviderConfigSource,
    readonly synchronizer: DroraBuiltinRemoteSynchronizer,
    readonly sourceDispose: () => void,
  ) {}

  dispose(): void {
    this.sourceDispose();
    this.synchronizer.dispose();
    this.source.dispose();
  }
}
