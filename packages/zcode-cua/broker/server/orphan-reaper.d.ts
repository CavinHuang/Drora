import { z } from "zod";
export declare var Jz: number, vGe: number;
export declare var JGe: number;
export declare var DVe: number;
export declare var Ooe: Readonly<{
    Button: "button";
    SplitButton: "button";
    MenuItem: "menuitem";
    Menu: "menuitem";
    MenuBar: "menuitem";
    Edit: "textfield";
    Document: "textarea";
    Password: "securefield";
    ComboBox: "combobox";
    CheckBox: "checkbox";
    RadioButton: "radio";
    Hyperlink: "link";
    Slider: "slider";
    ProgressBar: "slider";
    Text: "text";
    StatusBar: "text";
    Image: "image";
    ListItem: "row";
    DataItem: "row";
    TreeItem: "row";
    TabItem: "tab";
    Custom: "";
    Pane: "";
    Window: "";
    Group: "";
}>;
export declare var Yz: Set<string>, Doe: Set<string>;
export declare function Nh(e?: NodeJS.ProcessEnv): string;
export declare function Loe(e: any): boolean;
export declare function Ps(e?: NodeJS.ProcessEnv): boolean;
export declare var Z2e: string;
export declare var Uoe: number, zoe: string[];
export declare function eW(e?: NodeJS.ProcessEnv): string[];
export declare function sb(e: any): string;
export declare function ab(e: any, t: any): any;
export declare function Woe(e: any, t: any): any;
export declare function tW(e: any): boolean;
export declare function $oe(e: any): number;
export declare function nW(e: any, t: any): any;
export declare function Zoe(e: any): boolean;
export declare function ob(e: any, t: any, n: any): boolean;
export declare function cb(e: any, t: any, n: any, r?: any): boolean;
export declare function Xz(e: any, t: any): boolean;
export declare function db(e: any): any[];
export declare function rW(): any[];
export declare function ib(e: string[], t: (path: string) => string): string[];
export declare function lb(e?: any): (d: any, l: any) => {
    state: string;
    reason: string;
    command?: undefined;
} | {
    state: string;
    reason: string;
    command: any;
};
export declare function Hoe({ getRows: e, currentUid: t, selfPid: n, isProcessAlive: r, deadPids: o }: {
    getRows: any;
    currentUid: any;
    selfPid: any;
    isProcessAlive: any;
    deadPids: any;
}): (s: any) => {
    state: string;
    identity: string;
    reason: string;
    command?: undefined;
} | {
    state: string;
    reason: string;
    identity?: undefined;
    command?: undefined;
} | {
    state: string;
    identity: string;
    command: any;
    reason: string;
};
export declare function joe(e: any): any;
export declare function Koe(e: any): any;
export declare function oW(e?: any): {
    scanned: number;
    reaped: any[];
};
export declare function Fh(e: any): string;
export declare var Uh: number;
export declare var ni: z.ZodString, Bh: z.ZodNumber, Wh: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"focus-changed">;
    revision: z.ZodNumber;
    sourceWindowId: z.ZodString;
    sessionId: z.ZodNullable<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"turn-started">;
    sessionId: z.ZodString;
    turnId: z.ZodString;
    sequenceNumber: z.ZodNumber;
    eventId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"turn-ended">;
    sessionId: z.ZodString;
    turnId: z.ZodString;
    sequenceNumber: z.ZodNumber;
    eventId: z.ZodString;
    outcome: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"session-closed">;
    sessionId: z.ZodString;
    sequenceNumber: z.ZodNumber;
    eventId: z.ZodString;
}, z.core.$strict>], "kind">, UJe: z.ZodObject<{
    windowId: z.ZodNumber;
    presentationWindowId: z.ZodOptional<z.ZodNumber>;
    pid: z.ZodNumber;
    bundleId: z.ZodString;
}, z.core.$strict>;
export declare var jJe: z.ZodObject<{
    protocolVersion: z.ZodNumber;
    runtimeId: z.ZodString;
}, z.core.$strict>, KJe: z.ZodObject<{
    event: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"focus-changed">;
        revision: z.ZodNumber;
        sourceWindowId: z.ZodString;
        sessionId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"turn-started">;
        sessionId: z.ZodString;
        turnId: z.ZodString;
        sequenceNumber: z.ZodNumber;
        eventId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"turn-ended">;
        sessionId: z.ZodString;
        turnId: z.ZodString;
        sequenceNumber: z.ZodNumber;
        eventId: z.ZodString;
        outcome: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"session-closed">;
        sessionId: z.ZodString;
        sequenceNumber: z.ZodNumber;
        eventId: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export declare function oie(e: any): string;
export declare function iie(e: any): void;
