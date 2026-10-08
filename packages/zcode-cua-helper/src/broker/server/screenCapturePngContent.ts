export var MAX_PROBE_WINDOW_DIMENSION = 32768;
var MIN_CAPTURE_SCALE = 0.75;
var MAX_CAPTURE_SCALE = 4.5;
var MAX_AXIS_SCALE_RATIO = 1.35;
var MIN_VISIBLE_RATIO = 5e-3;
var MIN_VISIBLE_PIXELS = 4;
var MIN_NON_DOMINANT_RATIO = 25e-4;
var MIN_NON_DOMINANT_PIXELS = 3;
var MIN_DISTINCT_COLOR_BUCKETS = 3;
var MIN_CHANNEL_RANGE = 24;
var MAX_SAMPLE_DIMENSION = 64;
var MAX_SAMPLED_PIXELS = MAX_SAMPLE_DIMENSION * MAX_SAMPLE_DIMENSION;
function readUint32BigEndian(bytes, offset) {
  return (
    bytes[offset] * 16777216 +
    bytes[offset + 1] * 65536 +
    bytes[offset + 2] * 256 +
    bytes[offset + 3]
  );
}
export function readPngDimensions(bytes) {
  if (!bytes || bytes.length < 33) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) return null;
  if (readUint32BigEndian(bytes, 8) !== 13) return null;
  if (bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  const width = readUint32BigEndian(bytes, 16);
  const height = readUint32BigEndian(bytes, 20);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PROBE_WINDOW_DIMENSION * 4 ||
    height > MAX_PROBE_WINDOW_DIMENSION * 4
  ) {
    return null;
  }
  return { width, height };
}
export function pngDimensionsMatchWindow(png, window) {
  const scaleX = png.width / window.bounds.width;
  const scaleY = png.height / window.bounds.height;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX < MIN_CAPTURE_SCALE ||
    scaleX > MAX_CAPTURE_SCALE ||
    scaleY < MIN_CAPTURE_SCALE ||
    scaleY > MAX_CAPTURE_SCALE
  ) {
    return false;
  }
  return Math.max(scaleX, scaleY) / Math.min(scaleX, scaleY) <= MAX_AXIS_SCALE_RATIO;
}
function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
export function isDecodedNonPlaceholderPng(summary, dimensions) {
  if (
    !summary ||
    summary.width !== dimensions.width ||
    summary.height !== dimensions.height ||
    !positiveSafeInteger(summary.sampleWidth) ||
    summary.sampleWidth > MAX_SAMPLE_DIMENSION ||
    !positiveSafeInteger(summary.sampleHeight) ||
    summary.sampleHeight > MAX_SAMPLE_DIMENSION ||
    !positiveSafeInteger(summary.sampledPixelCount) ||
    summary.sampledPixelCount > MAX_SAMPLED_PIXELS ||
    summary.sampledPixelCount !== summary.sampleWidth * summary.sampleHeight ||
    !Number.isSafeInteger(summary.visiblePixelCount) ||
    summary.visiblePixelCount < 0 ||
    summary.visiblePixelCount > summary.sampledPixelCount ||
    !Number.isSafeInteger(summary.distinctColorBucketCount) ||
    summary.distinctColorBucketCount < 0 ||
    summary.distinctColorBucketCount > summary.visiblePixelCount ||
    !Number.isSafeInteger(summary.dominantColorPixelCount) ||
    summary.dominantColorPixelCount < 0 ||
    summary.dominantColorPixelCount > summary.visiblePixelCount ||
    !Number.isSafeInteger(summary.maxChannelRange) ||
    summary.maxChannelRange < 0 ||
    summary.maxChannelRange > 255
  ) {
    return false;
  }
  const minimumVisible = Math.max(
    MIN_VISIBLE_PIXELS,
    Math.ceil(summary.sampledPixelCount * MIN_VISIBLE_RATIO),
  );
  const minimumNonDominant = Math.max(
    MIN_NON_DOMINANT_PIXELS,
    Math.ceil(summary.sampledPixelCount * MIN_NON_DOMINANT_RATIO),
  );
  return (
    summary.visiblePixelCount >= minimumVisible &&
    summary.distinctColorBucketCount >= MIN_DISTINCT_COLOR_BUCKETS &&
    summary.visiblePixelCount - summary.dominantColorPixelCount >= minimumNonDominant &&
    summary.maxChannelRange >= MIN_CHANNEL_RANGE
  );
}
