// oxlint-disable-file -- 还原自发行 bundle 的 frame-contract 模块
// （restored-drafts/frame-contract.pretty.js.txt，导出名按 i(fn,"原始名") 注解恢复）。
// Official CUA raster 完整性门：image_ref 解析、raster 封套校验、producer 元数据绑定。
import { createHash } from "node:crypto";
export const OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";
export const OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION = "official_cua_frame_v1";
/** 被拒结果的 _meta 标注键（原版 rln；曾误用 INTEGRITY 键，同 48 轮键名还原错误模式）。 */
export const OFFICIAL_CUA_FRAME_REJECTIONS_META_KEY = "zcode.cua/frame-integrity-rejections-v1";
export const OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES = 200 * 1024;
/** 单次 result 允许的 image block 数上限（官方 CUA 每个结果只允许一张最终 raster）。 */
const MAX_IMAGE_REFS_PER_TEXT = 1024;
const MAX_TEXT_SCAN_LENGTH = 263168;
const MAX_JSON_CANDIDATES = 2048;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_RASTER_PIXELS = 16777216;
const MAX_INLINE_BASE64_BYTES = 200 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 解析一段 1024 字符以内的 image_ref JSON 文本。 */
function parseFrameImageRefTextLocal(text) {
    if (text.length === 0 || text.length > MAX_IMAGE_REFS_PER_TEXT)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !isRecord(parsed.image_ref)) {
        return undefined;
    }
    const ref = parsed.image_ref;
    if (Object.keys(ref).sort().join(", ") === "actionable, frame_id, height, width" &&
        typeof ref.frame_id === "string" &&
        ref.frame_id.length > 0 &&
        Number.isInteger(ref.width) &&
        ref.width > 0 &&
        Number.isInteger(ref.height) &&
        ref.height > 0 &&
        ref.actionable === true) {
        return {
            frameId: ref.frame_id,
            width: ref.width,
            height: ref.height,
        };
    }
    return undefined;
}
/** 在不做完整 JSON parse 的前提下扫描文本中的 JSON 对象候选。 */
function scanJsonObjectCandidates(text, test) {
    const limit = Math.min(text.length, MAX_TEXT_SCAN_LENGTH);
    const openBraces = [];
    let candidates = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < limit; i += 1) {
        const ch = text[i];
        if (inString) {
            if (!escaped && ch === '"')
                inString = false;
            escaped = !escaped && ch === "\\";
            if (ch !== "\\")
                escaped = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            openBraces.push(i);
            continue;
        }
        if (ch !== "}" || openBraces.length === 0)
            continue;
        const start = openBraces.pop();
        if (!(i + 1 - start > MAX_IMAGE_REFS_PER_TEXT)) {
            candidates += 1;
            if (candidates > MAX_JSON_CANDIDATES)
                return "overflow";
            if (test(text.slice(start, i + 1)))
                return "found";
        }
    }
    return text.length > MAX_TEXT_SCAN_LENGTH ? "overflow" : "none";
}
/** 文本整体（或其内嵌 JSON 候选）是否为一个 actionable image_ref。 */
export function isOfficialCuaImageRefText(text) {
    return parseFrameImageRefTextLocal(text) !== undefined;
}
/** 文本是否携带 image_ref 权威（含作为更大 JSON 的一部分或转义内嵌）。 */
export function containsOfficialCuaImageRefCredentialText(text) {
    if (isOfficialCuaImageRefText(text))
        return true;
    return scanJsonObjectCandidates(text, isOfficialCuaImageRefText) !== "none";
}
function parseOfficialCuaImageRefValue(value) {
    if (!isRecord(value) || !("image_ref" in value))
        return undefined;
    if (Object.keys(value).length !== 1 || !isRecord(value.image_ref))
        return null;
    const ref = value.image_ref;
    if (Object.keys(ref).sort().join(", ") !== "actionable, frame_id, height, width" ||
        typeof ref.frame_id !== "string" ||
        ref.frame_id.length === 0 ||
        !Number.isInteger(ref.width) ||
        ref.width <= 0 ||
        ref.width > MAX_IMAGE_DIMENSION ||
        !Number.isInteger(ref.height) ||
        ref.height <= 0 ||
        ref.height > MAX_IMAGE_DIMENSION ||
        ref.width * ref.height > MAX_RASTER_PIXELS ||
        ref.actionable !== true) {
        return null;
    }
    return {
        frameId: ref.frame_id,
        width: ref.width,
        height: ref.height,
    };
}
/** 从 text content block 解析 image_ref；超长文本仅做顶层 key 探测。 */
export function parseOfficialCuaImageRef(block) {
    if (!isRecord(block) ||
        block.type !== "text" ||
        typeof block.text !== "string") {
        return undefined;
    }
    const text = block.text;
    if (text.length > MAX_IMAGE_REFS_PER_TEXT) {
        return hasTopLevelJsonKey(text, "image_ref") ? null : undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    return parseOfficialCuaImageRefValue(parsed);
}
/** 递归判断结构化内容里是否携带 image_ref 权威。 */
export function containsImageRefAuthority(value) {
    const stack = [value];
    const seen = new Set();
    while (stack.length > 0) {
        const current = stack.pop();
        if (typeof current === "string") {
            if (containsOfficialCuaImageRefCredentialText(current))
                return true;
            continue;
        }
        if (typeof current !== "object" || current === null || seen.has(current))
            continue;
        seen.add(current);
        if (Array.isArray(current)) {
            for (const item of current)
                stack.push(item);
            continue;
        }
        const record = current;
        if (Object.hasOwn(record, "image_ref")) {
            const parsed = parseOfficialCuaImageRefValue({ image_ref: record.image_ref });
            if (parsed != null)
                return true;
        }
        for (const nested of Object.values(record))
            stack.push(nested);
    }
    return false;
}
function containsImageRefAuthorityText(text) {
    return containsOfficialCuaImageRefCredentialText(text);
}
/** 不完整 parse 的顶层 JSON key 探测（用于超长文本的 O(1) 判定）。 */
function hasTopLevelJsonKey(text, key) {
    let i = 0;
    while (/\s/u.test(text[i] ?? " "))
        i += 1;
    if (text[i] !== "{")
        return false;
    i += 1;
    let depth = 1;
    let atFirstKey = true;
    while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === '"') {
            const start = i;
            i += 1;
            let escaped = false;
            while (i < text.length) {
                const inner = text[i];
                if (!escaped && inner === '"')
                    break;
                escaped = !escaped && inner === "\\";
                if (inner !== "\\")
                    escaped = false;
                i += 1;
            }
            if (i >= text.length)
                return false;
            if (depth === 1 && atFirstKey) {
                let candidate;
                try {
                    candidate = JSON.parse(text.slice(start, i + 1));
                }
                catch {
                    return false;
                }
                let cursor = i + 1;
                while (/\s/u.test(text[cursor] ?? " "))
                    cursor += 1;
                if (text[cursor] === ":" && candidate === key)
                    return true;
            }
            i += 1;
            continue;
        }
        if (ch === "{" || ch === "[")
            depth += 1;
        else if (ch === "}" || ch === "]")
            depth -= 1;
        else if (depth === 1 && ch === ":")
            atFirstKey = false;
        else if (depth === 1 && ch === ",")
            atFirstKey = true;
        i += 1;
    }
    return false;
}
// ---- raster 封套（PNG/JPEG 头部）身份读取 ----
function readTiffOrientation(tiff) {
    if (tiff.length < 8)
        return null;
    const byteOrder = tiff.subarray(0, 2).toString("ascii");
    const littleEndian = byteOrder === "II";
    if (!littleEndian && byteOrder !== "MM")
        return null;
    const readUInt16 = (offset) => littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const readUInt32 = (offset) => littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    if (readUInt16(2) !== 42)
        return null;
    const ifdOffset = readUInt32(4);
    if (ifdOffset > tiff.length - 2)
        return null;
    const entryCount = readUInt16(ifdOffset);
    if (entryCount > 256 || ifdOffset + 2 + entryCount * 12 > tiff.length)
        return null;
    for (let entry = 0; entry < entryCount; entry += 1) {
        const entryOffset = ifdOffset + 2 + entry * 12;
        if (readUInt16(entryOffset) !== 274)
            continue;
        if (readUInt16(entryOffset + 2) !== 3 || readUInt32(entryOffset + 4) !== 1)
            return null;
        const value = readUInt16(entryOffset + 8);
        return value >= 1 && value <= 8 ? value : null;
    }
    return undefined;
}
function readJpegExifOrientation(segment) {
    if (segment.length < 6 || !segment.subarray(0, 6).equals(Buffer.from("Exif\0\0"))) {
        return undefined;
    }
    return readTiffOrientation(segment.subarray(6));
}
function readCompletePngEnvelope(png) {
    let offset = 8;
    let width = 0;
    let height = 0;
    let chunks = 0;
    let sawIDAT = false;
    const orientations = new Set();
    while (offset + 12 <= png.length) {
        const length = png.readUInt32BE(offset);
        const next = offset + 12 + length;
        if (next > png.length)
            return undefined;
        const type = png.subarray(offset + 4, offset + 8).toString("ascii");
        if (!/^[A-Za-z]{4}$/u.test(type))
            return undefined;
        if (chunks === 0) {
            if (type !== "IHDR" || length !== 13)
                return undefined;
            width = png.readUInt32BE(offset + 8);
            height = png.readUInt32BE(offset + 12);
            if (width <= 0 || height <= 0)
                return undefined;
        }
        else if (type === "IHDR") {
            return undefined;
        }
        if (type === "eXIf") {
            const orientation = readTiffOrientation(png.subarray(offset + 8, offset + 8 + length));
            if (orientation === null)
                return undefined;
            if (orientation !== undefined)
                orientations.add(orientation);
        }
        if (type === "IDAT")
            sawIDAT = true;
        if (type === "IEND") {
            return length === 0 && sawIDAT && next === png.length && orientations.size <= 1
                ? {
                    mimeType: "image/png",
                    width,
                    height,
                    orientation: orientations.values().next().value,
                }
                : undefined;
        }
        offset = next;
        chunks += 1;
    }
    return undefined;
}
/** 读取完整 PNG/JPEG 封套身份（含单值 EXIF orientation），不完整流返回 undefined。 */
export function readRasterEnvelopeIdentity(input) {
    if (!Buffer.isBuffer(input))
        return undefined;
    if (input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        return readCompletePngEnvelope(input);
    }
    if (input.length < 4 ||
        input[0] !== 255 ||
        input[1] !== 216 ||
        input[input.length - 2] !== 255 ||
        input[input.length - 1] !== 217) {
        return undefined;
    }
    const sofMarkers = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    let cursor = 2;
    let width;
    let height;
    const orientations = new Set();
    while (cursor < input.length) {
        while (cursor < input.length && input[cursor] !== 255)
            cursor += 1;
        while (cursor < input.length && input[cursor] === 255)
            cursor += 1;
        if (cursor >= input.length)
            return undefined;
        const marker = input[cursor];
        cursor += 1;
        if (marker === 217)
            return undefined;
        if (marker === 1 || (marker >= 208 && marker <= 216))
            continue;
        if (cursor + 2 > input.length)
            return undefined;
        const segmentLength = input.readUInt16BE(cursor);
        if (segmentLength < 2 || cursor + segmentLength > input.length)
            return undefined;
        if (sofMarkers.has(marker)) {
            if (segmentLength < 7)
                return undefined;
            const segHeight = input.readUInt16BE(cursor + 3);
            const segWidth = input.readUInt16BE(cursor + 5);
            if (segHeight <= 0 || segWidth <= 0 || width !== undefined)
                return undefined;
            height = segHeight;
            width = segWidth;
        }
        if (marker === 225) {
            const orientation = readJpegExifOrientation(input.subarray(cursor + 2, cursor + segmentLength));
            if (orientation === null)
                return undefined;
            if (orientation !== undefined)
                orientations.add(orientation);
        }
        if (marker === 218) {
            if (segmentLength < 2 ||
                cursor + segmentLength >= input.length - 2 ||
                width === undefined ||
                height === undefined ||
                orientations.size > 1) {
                return undefined;
            }
            return {
                mimeType: "image/jpeg",
                width: width,
                height: height,
                orientation: orientations.values().next().value,
            };
        }
        cursor += segmentLength;
    }
    return undefined;
}
/** 严格 canonical base64 解码（重编码必须逐字节一致）。 */
function decodeCanonicalBase64(encoded) {
    if (encoded.length === 0 ||
        encoded.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
        return undefined;
    }
    const decoded = Buffer.from(encoded, "base64");
    return decoded.length > 0 && decoded.toString("base64") === encoded ? decoded : undefined;
}
function formatBytes(bytes) {
    // 原版 Ost/formatByteSize：<1024 走 "X B"，否则 KiB（曾误还原为恒 "KB"）。
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}
function redactFrameIds(reasons, frameIds) {
    const redacted = [...new Set(frameIds)]
        .filter((id) => id.length > 0)
        .sort((a, b) => b.length - a.length);
    return reasons.map((reason) => {
        let redactedReason = reason;
        for (const id of redacted) {
            redactedReason = redactedReason
                .replaceAll(`frame ${id}`, "the frame")
                .replaceAll(id, "the frame");
        }
        return redactedReason
            .replaceAll(/\bframe\s+frame-[0-9a-z]+\b/giu, "the frame")
            .replaceAll(/\bframe-[0-9a-z]+\b/giu, "the frame");
    });
}
function inspectReferenceBlock(frameIds, rejectedReasons, parsed, index, result) {
    if (parsed === null) {
        rejectedReasons.push("image_ref is malformed or contains unsupported fields");
        return;
    }
    if (frameIds.has(parsed.frameId)) {
        rejectedReasons.push(`frame ${parsed.frameId} is duplicated in one result`);
    }
    frameIds.add(parsed.frameId);
    const content = result.content;
    content?.[index - 1]?.type !== "image" &&
        rejectedReasons.push(`frame ${parsed.frameId} is not immediately preceded by its image`);
}
async function inspectImageBlock(entry) {
    const dataBase64 = typeof entry.block.data === "string" ? entry.block.data : undefined;
    const mimeType = typeof entry.block.mimeType === "string" ? entry.block.mimeType : undefined;
    if (!dataBase64 || !mimeType?.startsWith("image/") || dataBase64.startsWith("data:")) {
        return `frame ${entry.reference.frameId} has invalid image bytes or media type`;
    }
    const encodedLength = dataBase64.length;
    if (encodedLength > 204800) {
        return `frame ${entry.reference.frameId} is ${formatBytes(encodedLength)}, exceeding the immutable inline limit ${formatBytes(204800)}`;
    }
    const bytes = decodeCanonicalBase64(dataBase64);
    if (!bytes)
        return `frame ${entry.reference.frameId} has invalid image bytes or media type`;
    const envelope = readRasterEnvelopeIdentity(bytes);
    if (!envelope ||
        envelope.mimeType !== mimeType ||
        envelope.width !== entry.reference.width ||
        envelope.height !== entry.reference.height) {
        return `frame ${entry.reference.frameId} image header does not match image_ref dimensions/media type`;
    }
    if (envelope.orientation !== undefined && envelope.orientation !== 1) {
        return `frame ${entry.reference.frameId} carries a non-canonical EXIF orientation`;
    }
    // 宿主图像处理器可用时做像素级一致性解码；不可用时 fail-closed。
    // 原版 HLs：JLs 返回的两条消息一律加 "frame <id> " 前缀（与其余拒绝原因一致）。
    if (!entry.imageProcessorPort) {
        return `frame ${entry.reference.frameId} cannot be fully decoded by the host image processor`;
    }
    try {
        const resized = await entry.imageProcessorPort.resizeToFit({
            data: bytes,
            maxDimension: Math.max(entry.reference.width, entry.reference.height),
            mediaType: mimeType,
        }, { signal: entry.signal });
        const identical = Buffer.from(resized.data).equals(bytes);
        const problem = resized.resized === false &&
            identical &&
            resized.mediaType === mimeType &&
            resized.originalWidth === entry.reference.width &&
            resized.originalHeight === entry.reference.height &&
            resized.width === entry.reference.width &&
            resized.height === entry.reference.height
            ? undefined
            : "decoded pixels do not match the immutable image_ref";
        return problem ? `frame ${entry.reference.frameId} ${problem}` : undefined;
    }
    catch (error) {
        if (entry.signal?.aborted)
            throw error;
        return `frame ${entry.reference.frameId} cannot be fully decoded by the host image processor`;
    }
}
function validateProducerFrameIntegrity(result, parsedReferences) {
    const content = result.content;
    const imageIndex = content.findIndex((block) => block.type === "image");
    if (imageIndex < 0 || imageIndex > content.length - 2) {
        return "producer frame integrity cannot bind an unpaired image";
    }
    const reference = parsedReferences[imageIndex + 1];
    const imageBlock = content[imageIndex];
    if (!reference || !imageBlock || imageBlock.type !== "image") {
        return "producer frame integrity cannot bind an invalid image pair";
    }
    // 原版 zcode.cjs 实证：gate 校验的 _meta 键是 producer（node_repl 宿主
    // withOfficialFrameIntegrity）写入的 "zcode.cua/official-frame-integrity-v1"，
    // 而 OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION("official_cua_frame_v1") 只是
    // core attest 的 kind 值——还原稿曾误用后者当键名，导致任何官方截图都被判
    // "metadata is missing" 拒绝。
    const meta = result._meta?.[OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY];
    if (!isRecord(meta)) {
        return "producer frame integrity metadata is missing";
    }
    if (Object.keys(meta).sort().join(", ") !== "frame_id, height, media_type, sha256, version, width") {
        return "producer frame integrity metadata has unsupported fields";
    }
    const dataBase64 = typeof imageBlock.data === "string" ? imageBlock.data : undefined;
    const bytes = dataBase64 ? decodeCanonicalBase64(dataBase64) : undefined;
    const mediaType = typeof imageBlock.mimeType === "string" ? imageBlock.mimeType : undefined;
    if (!bytes || !mediaType) {
        return "producer frame integrity image bytes are invalid";
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return meta.version === 1 &&
        meta.frame_id === reference.frameId &&
        meta.width === reference.width &&
        meta.height === reference.height &&
        meta.media_type === mediaType &&
        meta.sha256 === sha256
        ? undefined
        : "producer frame integrity metadata does not match the final raster";
}
async function inspectContentBlocks(entry) {
    for (const [index, block] of entry.result.content.entries()) {
        const parsed = entry.parsedReferences[index];
        if (parsed !== undefined) {
            inspectReferenceBlock(entry.frameIds, entry.rejectedReasons, parsed, index, entry.result);
        }
        if (block.type !== "image")
            continue;
        const nextParsed = entry.parsedReferences[index + 1];
        if (!nextParsed || nextParsed === null) {
            entry.rejectedReasons.push("image is missing a valid adjacent image_ref");
            continue;
        }
        const problem = await inspectImageBlock({
            block,
            imageProcessorPort: entry.imageProcessorPort,
            reference: nextParsed,
            signal: entry.signal,
        });
        if (problem)
            entry.rejectedReasons.push(problem);
    }
}
/** 官方 CUA raster 完整性门：任何不合格的 image/image_ref 对都会让整个结果变为 error。 */
export async function preserveOfficialCuaFrameResult(result, options) {
    const opts = (options ?? {});
    const rejectedReasons = [];
    const frameIds = new Set();
    const content = result.content;
    const parsedReferences = content.map((block) => parseOfficialCuaImageRef(block));
    const imageCount = content.filter((block) => block.type === "image").length;
    if (containsImageRefAuthority(result.structuredContent)) {
        rejectedReasons.push("structuredContent contains an unpaired image_ref authority");
    }
    if (imageCount > 1) {
        rejectedReasons.push(`result contains ${imageCount} images; official CUA allows exactly one final raster per result`);
    }
    await inspectContentBlocks({
        imageProcessorPort: opts.imageProcessorPort,
        parsedReferences,
        rejectedReasons,
        result,
        frameIds,
        signal: opts.signal,
    });
    if (imageCount === 1) {
        const integrityProblem = validateProducerFrameIntegrity(result, parsedReferences);
        if (integrityProblem)
            rejectedReasons.push(integrityProblem);
    }
    if (rejectedReasons.length === 0)
        return result;
    const redacted = redactFrameIds(rejectedReasons, frameIds);
    // 原版（cln）返回全新对象，仅 content/isError/_meta 三键——不 spread result：
    // 被拒时必须连同 structuredContent（可能携带 unpaired image_ref authority）一并
    // 丢弃（fail-closed），保留它将与拒绝文案的安全承诺直接矛盾。
    return {
        content: [
            {
                type: "text",
                text: `Official CUA image rejected by the exact-raster integrity gate. No raster authority or local artifact path was exposed; capture a new image and retry. Cause: ${redacted.join("; ")}.`,
            },
        ],
        isError: true,
        _meta: { [OFFICIAL_CUA_FRAME_REJECTIONS_META_KEY]: [...redacted] },
    };
}
function decodeCanonicalBoundedImageDataUrl(block) {
    const prefix = `data:${block.mediaType};base64,`;
    if (typeof block.dataUrl !== "string" || !block.dataUrl.startsWith(prefix))
        return undefined;
    const encoded = block.dataUrl.slice(prefix.length);
    if (encoded.length === 0 ||
        encoded.length > MAX_INLINE_BASE64_BYTES ||
        encoded.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
        return undefined;
    }
    const decoded = Buffer.from(encoded, "base64");
    return decoded.length > 0 && decoded.toString("base64") === encoded ? decoded : undefined;
}
function hasCanonicalBoundedImageDataUrl(block) {
    return decodeCanonicalBoundedImageDataUrl(block) !== undefined;
}
/** 从 tool 结果 content 中找出唯一一对 image + image_ref text。 */
export function findOfficialCuaFrameContentPair(content) {
    if (!Array.isArray(content))
        return undefined;
    const images = content
        .map((block, index) => ({ block, index }))
        .filter((entry) => entry.block.type === "image");
    if (images.length !== 1)
        return undefined;
    const image = images[0];
    const imageRefIndex = image.index + 1;
    const imageRef = content[imageRefIndex];
    const refTextBlockCount = content.filter((block) => block.type === "text" && isOfficialCuaImageRefText(block.text)).length;
    const refAdjacent = imageRef?.type === "text" &&
        isOfficialCuaImageRefText(imageRef.text) &&
        refTextBlockCount === 1;
    if (!refAdjacent)
        return undefined;
    if (!image.block.mediaType?.startsWith?.("image/"))
        return undefined;
    if (!hasCanonicalBoundedImageDataUrl(image.block))
        return undefined;
    return {
        image: image.block,
        imageRef,
        imageRefIndex,
        imageIndex: image.index,
    };
}
/** 对唯一 image+image_ref 对出具 raster 身份证明（kind 固定为内容保护标记）。 */
export function attestOfficialCuaFrameContent(content, expectedKind) {
    if (expectedKind !== undefined && expectedKind !== OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION) {
        return undefined;
    }
    const pair = findOfficialCuaFrameContentPair(content);
    if (!pair)
        return undefined;
    const parsedRef = parseOfficialCuaImageRef(pair.imageRef);
    const bytes = decodeCanonicalBoundedImageDataUrl(pair.image.dataUrl);
    if (!parsedRef || !bytes)
        return undefined;
    return {
        kind: OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION,
        frameId: parsedRef.frameId,
        mediaType: pair.image.mediaType,
        width: parsedRef.width,
        height: parsedRef.height,
        sha256: createHash("sha256").update(bytes).digest("hex"),
    };
}
