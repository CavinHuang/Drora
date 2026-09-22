import { AsyncLocalStorage as wae } from "node:async_hooks";
export declare function n$(e?: any): boolean;
export declare var fr: string;
export declare function dae(e: any): boolean;
export declare var Ft: {
    new (t?: string, n?: any): {
        code: any;
        details: any;
        permissionError: any;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
export declare function Ju(e: any, t?: {}): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare var Mb: string, xb: string, Ob: readonly string[];
export declare var Xh: string, Qh: string, ey: string, ty: string, ny: string, ry: string, lae: Readonly<{
    [Xh]: true;
    [Qh]: true;
    [ey]: boolean;
    [ty]: boolean;
    [ny]: true;
    [ry]: true;
}>, uae: readonly string[];
export declare var Db: string, Nb: string, Yu: string, Xu: string, pae: Readonly<{
    broker_not_accepting: string;
    broker_response_ambiguous: string;
    permission_refresh_in_progress: string;
    permission_refresh_invalid: string;
}>;
export declare var mae: number, s$: number;
export declare function Fb(e: any, t: any): number;
export declare function Bb(e: any, t: any, n: any): any;
export declare function Ub(e: any): boolean;
export declare function zb(e: any): {
    message: string;
    code: string;
    details: any;
};
export declare function Wb(e: any): string;
import "net";
export declare var hae: RegExp;
export declare function a$(e?: NodeJS.ProcessEnv): boolean;
export declare function c$(e?: NodeJS.ProcessEnv): boolean;
export declare function $b(e?: NodeJS.ProcessEnv): {
    verifySocketPeer(t: any, n: any): void;
};
export declare var yae: Readonly<{
    verifySocketPeer(e: any, t: any): void;
}>;
export declare var tXe: wae<unknown>;
export declare function Jc(): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare var Qu: {
    new (t: any, n: any): {
        socketPath: any;
        timeoutMs: any;
        peerChecker: any;
        maxFrameBytes: any;
        cancelSignal: any;
        onPresentation: any;
        authenticateParams: any;
        _nextId: number;
        requestId(): number;
        call(t: any, n: any, r?: {}): Promise<any>;
    };
};
export declare function d$(e: any, t: any, n: any, r?: string): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare function Sae(e: any, t: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare function oy(e: any, t: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export declare function kae(e: any, t: any, n: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
