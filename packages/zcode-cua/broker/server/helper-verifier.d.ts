import { hz } from "./helper-launcher.js";
export declare function $z(e: any): any;
export declare var coe: string, doe: string, bKe: readonly string[];
export declare var Oh: {
    readBundleInfo: typeof uoe;
    readExecutableArchs: typeof hz;
    verifyCodeSignature: typeof poe;
    inspectCodesignDetails: typeof foe;
    assessGatekeeper: typeof moe;
};
export declare function Dh(e: any, t: any, n: any, r?: {
    skipGatekeeperAssessment?: boolean;
}): Promise<{
    bundleInfo: any;
    codesign: any;
    releaseEligible: boolean;
    mode: string;
}>;
export declare function loe(e: any, t: any): Promise<any>;
export declare function uoe(e: any): Promise<{
    bundleId: string;
    version: string;
    buildVersion: string;
    executableName: string;
    buildId: string;
}>;
export declare function poe(e: any): Promise<void>;
export declare function foe(e: any): Promise<{
    teamIdentifier: string;
    authorities: string[];
    rawOutput: string;
    adHoc: boolean;
}>;
export declare function moe(e: any): Promise<void>;
export declare function goe(e: any, t: any): boolean;
export declare function hoe(e: any, t: any): string;
export declare function Hu(e: any): string;
export declare var jKe: readonly string[];
export declare var koe: Set<string>, S1e: Set<string>;
export declare var cqe: Set<string>;
export declare function nb(e: any, t: any): boolean;
export declare function tb(e: any): boolean;
export declare function rb(e: any, t: any): boolean;
export declare var qz: number;
export declare var Roe: number, Aoe: number;
export declare function Gz(e: any, t: any): boolean;
export declare function Eoe(e: any): boolean;
export declare function Vz(e: any): boolean;
