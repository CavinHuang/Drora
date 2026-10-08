import { captureForeignWindowProbeEvidence } from "./screenCaptureEvidence.js";

export function createForeignWindowScreenCaptureProbe(adapter, readStatus) {
  return async () => {
    const status = readStatus();
    const probePid = process.pid;
    if (status !== "granted") {
      return {
        ok: false,
        status,
        probed: false,
        byte_length: 0,
        error: null,
        evidence: "none",
        probe_pid: probePid,
        target_window_id: null,
        target_owner_pid: null,
        target_on_screen: null,
        target_bounds: null,
        png_width: null,
        png_height: null,
        content_evidence: "none",
        candidate_count: 0,
        attempted_window_count: 0,
        sample_width: null,
        sample_height: null,
        sampled_pixel_count: null,
        visible_pixel_count: null,
        distinct_color_bucket_count: null,
        dominant_color_pixel_count: null,
        max_channel_range: null,
      };
    }
    const evidence: any = await captureForeignWindowProbeEvidence(adapter, probePid);
    const target = evidence.window;
    const common = {
      status,
      probe_pid: probePid,
      target_window_id: target?.windowId ?? null,
      target_owner_pid: target?.ownerPid ?? null,
      target_on_screen: target?.onScreen ?? null,
      target_bounds: target
        ? [target.bounds.x, target.bounds.y, target.bounds.width, target.bounds.height]
        : null,
      candidate_count: evidence.candidateCount,
      attempted_window_count: evidence.attemptedWindowCount,
    };
    if (evidence.ok) {
      return {
        ...common,
        ok: true,
        probed: true,
        byte_length: evidence.png.length,
        error: null,
        evidence: "foreign_window",
        png_width: evidence.dimensions.width,
        png_height: evidence.dimensions.height,
        content_evidence: "decoded_visible_non_uniform",
        sample_width: evidence.content.sampleWidth,
        sample_height: evidence.content.sampleHeight,
        sampled_pixel_count: evidence.content.sampledPixelCount,
        visible_pixel_count: evidence.content.visiblePixelCount,
        distinct_color_bucket_count: evidence.content.distinctColorBucketCount,
        dominant_color_pixel_count: evidence.content.dominantColorPixelCount,
        max_channel_range: evidence.content.maxChannelRange,
      };
    }
    const errorByReason: any = {
      unsupported: "foreign_window_probe_unavailable",
      no_window: "foreign_window_unavailable",
      empty: "captured_window_empty",
      invalid: "captured_window_png_invalid",
      mismatch: "captured_window_size_mismatch",
      content_invalid: "captured_window_content_invalid",
      content_indeterminate: "captured_window_content_indeterminate",
      enumeration_error: evidence.error ?? "foreign_window_enumeration_failed",
      capture_error: evidence.error ?? "foreign_window_capture_failed",
      inspection_error: evidence.error ?? "foreign_window_inspection_failed",
    };
    return {
      ...common,
      ok: false,
      probed: evidence.attemptedWindowCount > 0,
      byte_length: evidence.png?.length ?? 0,
      error: errorByReason[evidence.reason],
      evidence: "none",
      png_width: evidence.dimensions?.width ?? null,
      png_height: evidence.dimensions?.height ?? null,
      content_evidence: "none",
      sample_width: evidence.content?.sampleWidth ?? null,
      sample_height: evidence.content?.sampleHeight ?? null,
      sampled_pixel_count: evidence.content?.sampledPixelCount ?? null,
      visible_pixel_count: evidence.content?.visiblePixelCount ?? null,
      distinct_color_bucket_count: evidence.content?.distinctColorBucketCount ?? null,
      dominant_color_pixel_count: evidence.content?.dominantColorPixelCount ?? null,
      max_channel_range: evidence.content?.maxChannelRange ?? null,
    };
  };
}
