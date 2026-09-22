export declare const OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";
export declare const OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION = "official_cua_frame_v1";
export declare const OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES: number;
export interface OfficialFrameImageRef {
    frameId: string;
    width: number;
    height: number;
}
export interface RasterEnvelopeIdentity {
    mimeType: string;
    width: number;
    height: number;
    orientation?: number;
}
/** 文本整体（或其内嵌 JSON 候选）是否为一个 actionable image_ref。 */
export declare function isOfficialCuaImageRefText(text: string): boolean;
/** 文本是否携带 image_ref 权威（含作为更大 JSON 的一部分或转义内嵌）。 */
export declare function containsOfficialCuaImageRefCredentialText(text: string): boolean;
/** 从 text content block 解析 image_ref；超长文本仅做顶层 key 探测。 */
export declare function parseOfficialCuaImageRef(block: unknown): OfficialFrameImageRef | null | undefined;
/** 递归判断结构化内容里是否携带 image_ref 权威。 */
export declare function containsImageRefAuthority(value: unknown): boolean;
/** 读取完整 PNG/JPEG 封套身份（含单值 EXIF orientation），不完整流返回 undefined。 */
export declare function readRasterEnvelopeIdentity(input: unknown): RasterEnvelopeIdentity | undefined;
/** 官方 CUA raster 完整性门：任何不合格的 image/image_ref 对都会让整个结果变为 error。 */
export declare function preserveOfficialCuaFrameResult<T extends {
    content?: unknown;
    isError?: boolean;
}>(result: T, options?: unknown): Promise<T>;
export interface OfficialCuaFrameAttestation {
    kind: string;
    frameId: string;
    mediaType: string;
    width: number;
    height: number;
    sha256: string;
}
export interface OfficialCuaFrameContentPair {
    image: any;
    imageRef: any;
    imageRefIndex: number;
    imageIndex: number;
}
/** 从 tool 结果 content 中找出唯一一对 image + image_ref text。 */
export declare function findOfficialCuaFrameContentPair(content: unknown): OfficialCuaFrameContentPair | undefined;
/** 对唯一 image+image_ref 对出具 raster 身份证明（kind 固定为内容保护标记）。 */
export declare function attestOfficialCuaFrameContent(content: unknown, expectedKind?: string): OfficialCuaFrameAttestation | undefined;
