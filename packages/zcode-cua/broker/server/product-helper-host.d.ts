export declare function JW(e: any): {
    options: any;
    handle: any;
    resolverPluginAuthority: any;
    pluginAuthorityMintError: any;
    startInFlight: any;
    pendingTermination: any;
    terminationInFlight: any;
    pendingFailedLaunch: any;
    failedLaunchCleanupInFlight: any;
    restartAfterCurrentStartInFlight: any;
    restartPreservingTransportInFlight: any;
    pendingRefreshMarker: any;
    reservation: any;
    pendingReservedTuple: any;
    stopGeneration: number;
    collectHelperPidEvidence: any;
    get running(): boolean;
    get socketPath(): any;
    get pluginAuthority(): any;
    get reservedTransport(): any;
    resolveResolverPluginAuthority(): any;
    start(): Promise<any>;
    doStart(t: any, n: any, r?: string): Promise<any>;
    injectInto(t: any): any;
    stop(): Promise<void>;
    stopCurrentHandle(t: any, n?: any, r?: boolean): Promise<void>;
    releaseReservationIfUnpublished(): Promise<void>;
    releasePublishedReservation(): Promise<void>;
    assertNotExternallyStopped(t: any): void;
    beginFreshRestart(t: any): Promise<any>;
    completeRefreshMarkerAfterTransportRetired(): Promise<void>;
    retryCompletedRefreshMarkerForLiveHandle(): Promise<{
        handle: any;
        reused: boolean;
    }>;
    beginTransportPreservingRestart(t: any, n: any): Promise<{
        handle: any;
        reused: boolean;
    }>;
    finishPendingTermination(t: any, n?: any, r?: boolean): Promise<void>;
    recordAndCleanupFailedLaunch(t: any, n: any, r?: any): Promise<void>;
    finishPendingFailedLaunch(t: any): Promise<void>;
    runFailedLaunchCleanup(t: any, n: any): Promise<void>;
    ensureFailedLaunchRevoked(t: any): void;
    terminateHelperPid(t: any, n: any, r?: {}, o?: {
        allowSigkill?: boolean;
        termGraceMs?: number;
    }, s?: boolean): Promise<void>;
    runTerminationSequence(t: any, n: any, r: any, o: any): Promise<void>;
    signalHelperIfStillOwned(t: any, n: any, r: any, o: any): boolean;
    waitForHelperDeparture(t: any, n: any, r: any, o: any): Promise<boolean>;
    readHelperPidEvidence(t: any, n: any): any;
    restart(): Promise<any>;
    restartAfterCurrentStart(): Promise<any>;
    restartAfterCurrentStartPreservingTransport(t?: {
        beforeFreshStart?: () => void;
    }): Promise<any>;
    checkHealth(t?: number): Promise<any>;
    queryPermissionStatus(t?: number): Promise<any>;
    queryScreenRecordingPreflight(t: any): Promise<any>;
    queryScreenCaptureProbe(t?: number): Promise<any>;
};
export declare function Eb(e: any, t?: () => void): any;
export declare var Kse: number, Gu: WeakMap<WeakKey, any>;
export declare function qse(e: any): any;
export declare function zi(e: any): any;
export declare function YW(e: any): any;
export declare function Gse(e: any, t: any): boolean;
export declare function Rr(e: any): boolean;
export declare function XW(e: any): void;
export declare function Vu(e: any, t?: number): Promise<any>;
export declare function QW(e: any, t?: {
    hasActiveTurn?: () => boolean;
}): {
    resolveMcpServers(M: any): Promise<any>;
    restart(): Promise<void>;
    restartAfterPermissionGrant(M: any): Promise<void>;
    reconcileRecoveredHelper(): Promise<void>;
};
export declare var Vh: {
    new (): {
        targetsByWorkspaceKey: Map<any, any>;
        setEnabled(t: any, n: any): void;
        snapshot(): any[];
        pruneDisabled(t: any): void;
    };
};
export declare var Jh: {
    new (t: any): {
        stopInstance: any;
        current: any;
        retiring: any;
        terminal: boolean;
        transitionTail: Promise<void>;
        disposePromise: any;
        get disposed(): boolean;
        isCurrent(t: any): boolean;
        peek(): any;
        acquire(t: any): Promise<void>;
        reconcile(t: any): Promise<void>;
        dispose(): any;
        stopCurrentIfNeeded(t: any): Promise<void>;
        finishRetiringInstance(): Promise<void>;
        enqueue(t: any): Promise<void>;
    };
};
export declare var Qse: string[], eae: string;
export declare function tae(e: any): string[];
export declare function t$(e: any): boolean;
export declare function nae(e: any): {
    configured: boolean;
    enabled: boolean;
};
export declare function rae(e: any): any[];
export declare function oae(e: any): boolean;
export declare function iae(e: any): any;
export declare function Yh(e: any): any;
export declare function Vc(e: any, t: any): any;
