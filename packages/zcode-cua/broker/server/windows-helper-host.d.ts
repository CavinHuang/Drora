import { Uu } from "../socket-path.js";
export declare var RXe: Readonly<Set<string>>;
export declare var iy: string, p$: string, f$: {
    fork(e: any, t: any, n: any): import("node:child_process").ChildProcess;
}, m$: typeof Uu, g$: (e: any, t: any) => Promise<import("../index.js").HelperHealth>, sy: {
    new (t: any): {
        logger: any;
        terminate(t: any, n: any, r: any): Promise<void>;
        sendShutdown(t: any, n: any): void;
        kill(t: any, n: any): void;
        on(t: any, n: any, r: any, o: any, s: any): boolean;
        off(t: any, n: any, r: any, o: any, s: any): void;
        logFailure(t: any, n: any, r: any, o: any): void;
        waitForExit(t: any, n: any, r: any): Promise<unknown>;
    };
};
export declare function h$(e: any): "ignore" | {
    protocol: string;
    type: string;
    message: any;
    socketPath?: undefined;
    pid?: undefined;
} | {
    protocol: string;
    type: any;
    socketPath: any;
    pid: any;
    message?: undefined;
};
export declare function y$(e: any, t: any): boolean;
export declare function ay(e: any): Error;
export declare var Eae: () => string, w$: number, v$: number, ep: {
    new (t: any): {
        options: any;
        childProcess: any;
        mintSocketPath: any;
        healthProbe: any;
        startupTimeoutMs: any;
        shutdownTimeoutMs: any;
        logger: any;
        childLifecycle: any;
        authority: any;
        handle: any;
        lastAgentVisibleTransport: any;
        current: any;
        lifecycleTail: Promise<void>;
        terminationBlocker: any;
        startInFlight: any;
        startInFlightEpoch: any;
        restartInFlight: any;
        restartAfterStartInFlight: any;
        restartPreservingTransportInFlight: any;
        transportReadyInFlight: any;
        transportReadyResolve: any;
        transportReadyReject: any;
        nextGeneration: number;
        externalStopEpoch: number;
        get running(): boolean;
        get socketPath(): any;
        get pluginAuthority(): any;
        waitForTransport(t?: number): Promise<unknown>;
        start(): any;
        stop(): Promise<any>;
        restart(): any;
        restartAfterCurrentStart(): any;
        restartAfterCurrentStartPreservingTransport(t?: {
            beforeFreshStart?: () => void;
        }): any;
        checkHealth(t?: number): Promise<any>;
        enqueue(t: any): Promise<any>;
        startNow(t: any, n?: any): Promise<any>;
        createTransportReadyPromise(): void;
        resolveTransportReady(t: any): void;
        rejectTransportReady(t: any): void;
        invalidateTransportReady(): void;
        stopNow(t: any): Promise<void>;
        startGeneration(t: any, n: any): Promise<unknown>;
        terminateGeneration(t: any, n: any): any;
        terminateGenerationOnce(t: any, n: any): Promise<void>;
        invalidateForExternalStop(t: any): any;
    };
};
export declare function Tae(e: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare function S$(e: any): {
    connect: () => Promise<void>;
    send: (v: any) => Promise<void>;
    readonly enabled: boolean;
    close(): void;
};
export declare function Wi(e: any): {
    kind: any;
    revision: any;
    sessionId: any;
    sourceWindowId: any;
} | {
    outcome?: any;
    turnId?: any;
    eventId: any;
    kind: any;
    sequenceNumber: any;
    sessionId: any;
    revision?: undefined;
    sourceWindowId?: undefined;
};
