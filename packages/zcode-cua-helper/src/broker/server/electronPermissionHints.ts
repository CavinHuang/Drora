import { authorizationSubjectKind } from "./nativeBackend.js";

function authorizationSubjectActionName(brokerInfo) {
  switch (authorizationSubjectKind(brokerInfo)) {
    case "zcode_helper":
      return "zcode_cua_helper";
    case "zcode_app":
      return "zcode";
    default:
      return "authorization_subject";
  }
}
function authorizationSubjectDisplayName(brokerInfo) {
  switch (authorizationSubjectKind(brokerInfo)) {
    case "zcode_helper":
      return "ZCode Computer Use.app";
    case "zcode_app":
      return "ZCode.app";
    default:
      return brokerInfo.display_name || brokerInfo.bundle_id || "the ZCode authorization subject";
  }
}
function restartInstruction(brokerInfo) {
  return authorizationSubjectKind(brokerInfo) === "zcode_helper"
    ? "fully quit and reopen ZCode so it can restart the Helper"
    : "fully quit and restart ZCode";
}
export function accessibilityActionRequired(brokerInfo) {
  return `grant_accessibility_to_${authorizationSubjectActionName(brokerInfo)}`;
}
export function screenRecordingActionRequired(brokerInfo) {
  return `grant_screen_recording_to_${authorizationSubjectActionName(brokerInfo)}_and_restart`;
}
export function automationActionRequired(status, brokerInfo) {
  if (status === "granted") return null;
  const subject = authorizationSubjectActionName(brokerInfo);
  if (status === "denied") return `grant_automation_to_${subject}_for_system_events`;
  return `retry_request_access_or_grant_automation_to_${subject}_for_system_events`;
}
export function permissionGuideMessage(args) {
  const { brokerInfo, accessibility, screenRecording } = args;
  const appName = authorizationSubjectDisplayName(brokerInfo);
  const line = (label, perm, purpose, status) => {
    const mark =
      status === "granted"
        ? "\u2705 \u5DF2\u6388\u6743"
        : status === "not_required"
          ? "\u2014 \u672C\u6B21\u4E0D\u9700\u8981"
          : "\u26A0\uFE0F \u7F3A\u5931\uFF0C\u8BF7\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u91CC\u6253\u5F00";
    return `  \u2022 ${label}\uFF08${perm}\uFF09\u2014 ${purpose}\uFF1A${mark}`;
  };
  const anyMissing =
    (accessibility !== "granted" && accessibility !== "not_required") ||
    (screenRecording !== "granted" && screenRecording !== "not_required");
  if (brokerInfo.platform === "win32") {
    const winAppName = appName.replace(/\.app$/u, "");
    const winLine = (label, probe, status) => {
      const mark =
        status === "granted"
          ? "\u2705 \u53EF\u7528"
          : status === "not_required"
            ? "\u2014 \u672C\u6B21\u4E0D\u9700\u8981"
            : "\u26A0\uFE0F \u4E0D\u53EF\u7528";
      return `  \u2022 ${label}\uFF08${probe}\uFF09\u2014 ${mark}`;
    };
    const winHead = anyMissing
      ? `${winAppName} \u5728 Windows \u4E0A\u65E0\u9700\u7CFB\u7EDF\u6388\u6743\uFF0C\u4F46\u4EE5\u4E0B\u80FD\u529B\u5F53\u524D\u4E0D\u53EF\u7528\u3002\u5E38\u89C1\u6210\u56E0\uFF1A\u76EE\u6807\u8FDB\u7A0B\u4EE5\u7BA1\u7406\u5458\u8FD0\u884C\uFF08UIPI \u963B\u6B62\u975E\u63D0\u6743\u7684 ZCode \u9A71\u52A8\u5B83\uFF0C\u8BF7\u4EE5\u7BA1\u7406\u5458\u91CD\u542F ZCode\uFF09\u3001ZCode \u8FD0\u884C\u5728\u975E\u4EA4\u4E92\u4F1A\u8BDD\uFF08Session 0 / \u670D\u52A1 / SSH \u767B\u5F55\uFF09\u3001\u6216\u76EE\u6807\u65E0\u53EF\u89C1\u9876\u5C42\u7A97\u53E3\uFF1A`
      : `${winAppName} \u5728 Windows \u4E0A\u65E0\u9700\u7CFB\u7EDF\u6388\u6743\uFF0C\u6240\u9700\u80FD\u529B\u5747\u5DF2\u53EF\u7528\u3002`;
    return [
      winHead,
      winLine(
        "\u8F93\u5165\u4E0E\u65E0\u969C\u788D\u6811\uFF08UI Automation\uFF09",
        "accessibility probe",
        accessibility,
      ),
      winLine(
        "\u5C4F\u5E55\u6355\u83B7\uFF08WGC/DXGI\uFF09",
        "screen capture probe",
        screenRecording,
      ),
    ].join("\n");
  }
  const head = anyMissing
    ? `${appName} \u9700\u8981\u4EE5\u4E0B\u4E24\u9879 macOS \u6743\u9650\u624D\u80FD\u64CD\u63A7\u4F60\u7684\u7535\u8111\u3002macOS \u6B63\u5728\u4E3A\u7F3A\u5931\u7684\u9879\u5F39\u51FA\u7CFB\u7EDF\u6388\u6743\u5BF9\u8BDD\u6846\uFF0C\u8BF7\u70B9\u300C\u5141\u8BB8 / \u6253\u5F00\u7CFB\u7EDF\u8BBE\u7F6E\u300D\uFF0C\u5728\u300C\u7CFB\u7EDF\u8BBE\u7F6E \u25B8 \u9690\u79C1\u4E0E\u5B89\u5168\u6027\u300D\u91CC\u6253\u5F00\u300C${appName}\u300D\u7684\u5F00\u5173\uFF0C\u7136\u540E**\u5B8C\u5168\u9000\u51FA\uFF08\u2318Q\uFF09\u5E76\u91CD\u5F00 ZCode**\uFF08Helper \u8FDB\u7A0B\u9700\u8981\u91CD\u542F\u624D\u80FD\u8BFB\u5230\u65B0\u6388\u6743\uFF09\uFF1A`
    : `${appName} \u6240\u9700\u7684\u4E24\u9879 macOS \u6743\u9650\u5747\u5DF2\u6388\u6743\u3002`;
  const tail = anyMissing
    ? `
\u6CE8\u610F\uFF1A\u6388\u6743\u5BF9\u8C61\u5FC5\u987B\u662F\u300C${appName}\u300D\u3002\u82E5\u5217\u8868\u91CC\u540C\u65F6\u51FA\u73B0\u540C\u540D\u7684 ZCode \u4E3B\u7A0B\u5E8F\uFF0C\u8BF7\u786E\u8BA4\u5F00\u5173\u7684\u662F Helper \u8FD9\u4E00\u9879 \u2014\u2014 \u8FD9\u662F\u5BFC\u81F4"\u6388\u6743\u4E86\u5374\u6CA1\u751F\u6548\u3001\u53CD\u590D\u5F39\u7A97"\u6700\u5E38\u89C1\u7684\u539F\u56E0\u3002`
    : "";
  return [
    head,
    line(
      "\u8F85\u52A9\u529F\u80FD",
      "Accessibility",
      "\u8BFB\u53D6\u4E0E\u9A71\u52A8 UI \u5143\u7D20 / \u5408\u6210\u952E\u9F20",
      accessibility,
    ),
    line("\u5C4F\u5E55\u5F55\u5236", "Screen Recording", "\u622A\u5C4F", screenRecording),
    tail,
  ].join("\n");
}
export function authorizationSubject(brokerInfo) {
  const diagnostics = brokerInfo.authorization_subject;
  return {
    kind: diagnostics?.kind ?? authorizationSubjectKind(brokerInfo),
    bundle_id: diagnostics?.bundle_id ?? brokerInfo.bundle_id,
    display_name: diagnostics?.display_name ?? brokerInfo.display_name,
    version: diagnostics?.version ?? brokerInfo.version,
    ...(diagnostics?.pid !== void 0 ? { pid: diagnostics.pid } : {}),
    ...(diagnostics?.app_bundle_path !== void 0
      ? { app_bundle_path: diagnostics.app_bundle_path }
      : {}),
    ...(diagnostics?.code_signing_identifier !== void 0
      ? { code_signing_identifier: diagnostics.code_signing_identifier }
      : {}),
    ...(diagnostics?.team_identifier !== void 0
      ? { team_identifier: diagnostics.team_identifier }
      : {}),
    ...(diagnostics?.signature !== void 0 ? { signature: diagnostics.signature } : {}),
    stable_identity: diagnostics?.stable_identity ?? true,
    warnings: diagnostics?.warnings ?? [],
    ...(diagnostics ? { diagnostics } : {}),
  };
}
function nonDarwinAuthorizationSubjectHint(brokerInfo, permissionName) {
  const diagnostics = brokerInfo.authorization_subject;
  const subjectPath = diagnostics?.app_bundle_path ?? diagnostics?.executable_path ?? null;
  const subject = subjectPath ? `Current ZCode authorization subject is ${subjectPath}. ` : "";
  const head = `${permissionName} is a macOS privacy permission; on ${brokerInfo.platform} there is no per-app ${permissionName} switch to grant, so a missing privacy grant is not what blocks this call.`;
  const causes =
    brokerInfo.platform === "win32"
      ? " Check instead: the target process runs elevated (Windows UIPI blocks UI Automation from a non-elevated ZCode \u2014 restart ZCode elevated to reach it), the target has no visible top-level window, or ZCode runs in a non-interactive session (Session 0, a service, or an SSH login)."
      : " Check instead: the accessibility bus is reachable (AT-SPI enabled under a real desktop session, not headless), and the target toolkit actually exposes an accessibility tree.";
  return `${subject}${head}${causes}`;
}
export function authorizationSubjectHint(brokerInfo, permissionName) {
  if (brokerInfo.platform !== "darwin") {
    return nonDarwinAuthorizationSubjectHint(brokerInfo, permissionName);
  }
  const diagnostics = brokerInfo.authorization_subject;
  const subjectName = authorizationSubjectDisplayName(brokerInfo);
  const generic = `Grant ${permissionName} to ${subjectName} in System Settings > Privacy & Security, then ${restartInstruction(brokerInfo)}.`;
  if (!diagnostics) return generic;
  const subjectPath =
    diagnostics.app_bundle_path ?? diagnostics.executable_path ?? `current ${subjectName} process`;
  const signing = diagnostics.code_signing_identifier ?? "unknown";
  const team = diagnostics.team_identifier ?? "none";
  const signature = diagnostics.signature ?? "unknown";
  const details = `Current ZCode authorization subject is ${subjectPath} (signing_identifier=${signing}, team=${team}, signature=${signature}).`;
  const warnings =
    diagnostics.warnings.length > 0 ? ` Warnings: ${diagnostics.warnings.join("; ")}.` : "";
  if (!diagnostics.stable_identity) {
    return `${details}${warnings} This is not a stable signed ${brokerInfo.bundle_id} identity, so grants for a different ${subjectName} copy may not apply. Grant ${permissionName} to this exact app copy and ${restartInstruction(brokerInfo)}.`;
  }
  return `${details}${warnings} ${generic}`;
}
