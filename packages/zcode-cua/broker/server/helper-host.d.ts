import { realpathSync as xW } from "node:fs";
export declare var MW: RegExp, qn: {
    new (t: any, n?: any, r?: any): {
        observedSocketOwnerPid: any;
        code: string;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
export declare function DW(e: any): Promise<number[]>;
export declare function hse(): Promise<any[]>;
export declare var yse: {
    listUnixSocketOwnerPids: typeof DW;
    verifyProcessCodeSignature(e: any, t: any): Promise<void>;
    readProcessHostingPaths(e: any): Promise<string[]>;
    canonicalize: typeof xW;
}, wse: {
    listUnixSocketOwnerPids: typeof DW;
    listProcesses: typeof hse;
    currentUid: () => number;
    canonicalize: typeof xW;
};
export declare function NW(e: any, t?: {
    listUnixSocketOwnerPids: typeof DW;
    listProcesses: typeof hse;
    currentUid: () => number;
    canonicalize: typeof xW;
}): Promise<{
    detail?: string;
    state: string;
    pids: unknown[];
}>;
export declare function vse(e: any): string;
export declare function LW(e: any, t?: {
    listUnixSocketOwnerPids: typeof DW;
    verifyProcessCodeSignature(e: any, t: any): Promise<void>;
    readProcessHostingPaths(e: any): Promise<string[]>;
    canonicalize: typeof xW;
}): Promise<{
    pid: any;
}>;
export declare function FW(e: any): boolean;
export declare function BW(): string;
export declare var bse: string, Ise: string, _se: string;
export declare function _b(e: any): boolean;
export declare function Rse(e?: NodeJS.ProcessEnv): string;
export declare function zW(e: any): Promise<void>;
export declare function Lse(e: any, t: any): void;
export declare function Fse(e: any): Promise<void>;
export declare function Gh(e: any): Promise<void>;
export declare function Bse(e: any, t: any): Promise<void>;
export declare function Rb(e: any): Promise<void>;
export declare function KW(e: any): Promise<{
    pendingSocketPath: string;
    readonly holdsPublishedPath: boolean;
    publish(): any;
    release(): any;
    unlinkPublishedIfOwned(): any;
}>;
export declare var $se: string, GW: number, Zse: number, Hse: string, CuaHelperHost: {
    new (t: any): {
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
};
export declare function jse(e: any, t: any): void;
export declare function VW(e: any): Promise<unknown>;
