# pass27 B2² 附件/图片/office 渲染链对拍报告（2026-10-08）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，14,820,819 B 单行 bundle，证据以字节偏移表示）
- 我方：`D:\workspace\projects\Drora` @ feat/migrate-remote-and-pet（基线新鲜，ahead 14）
- 方法：全链 grep -ob 取偏移 + 短窗提取重测；我方逐文件对照。只读对拍，未改任何代码。

## §1 附件 canonical

结论：**1:1 对平**（除有意改名 zcode→drora）。

真值重测规格与我方对应：

| 项 | 真值（偏移） | 我方（文件） | 判定 |
| --- | --- | --- | --- |
| 输入附件类型全集 | `url/image/video/pdf/file` + `sourceKind:"clipboard-text"`（内部形状，nwa@12750200 分支） | `contracts/src/interfaces/session.port.ts:319` PendingTurnAttachment 同全集 | 一致 |
| 协议层 prompt attachment schema | discriminatedUnion(kind)：image/video/pdf/file（file 必填 sizeBytes、可 textContent）；另一形态含 audio + `.strict()`（807229） | `packages/shared/src/task-realtime-core.ts:161` droraPromptAttachmentSchema 同四类+audio+strict | 一致（见 OQ-2） |
| 解析主链 | Jxo/w_t/nwa/rwa/owa/Hxo/Vxo（12748925..12752796），函数名与语义与我方同名 | `core/src/runtime/helpers/attachments.ts`、`attachment-media-resolver.ts` | 逐分支一致 |
| url 型 | resource_link + metadata_only/remote_ref（12750270 附近） | attachments.ts:102-114 | 一致 |
| inline pdf 校验 | 非 data/artifact 直接 placeholder `attachment_pdf_invalid`（nwa）；parseInlinePdfDataUrl 严格 header+base64+`%PDF-`（$xo/Pkn，12738900，上限 v_t=20MiB@12739032） | attachments.ts:117-129、attachment-pdf.ts（PDF_INPUT_MAX_BYTES=20MiB） | 一致 |
| 文件路径型 | stat→非 file→`attachment_not_file`；!isTextLikePath→binary_file path-ref；clipboard-text→`deferred_clipboard_text`；>256KiB→allowPartialFallback limit 2000 offset 1（owa@12750750；i3=256KiB、nH=2e3@1336700） | attachments.ts:202-304（READ_MAX_FILE_SIZE_BYTES=256KiB、READ_DEFAULT_MAX_LINES=2000） | 一致 |
| 文本路径白名单 | `(cjs\|conf\|cpp\|cs\|css\|csv\|go\|h\|hpp\|html\|ini\|java\|js\|json\|jsx\|log\|md\|mjs\|py\|rs\|sh\|sql\|toml\|ts\|tsx\|txt\|xml\|yaml\|yml)$`（Rkn@12740036） | attachment-path-reference.ts:77-81 同正则 | 一致 |
| 占位符降级 | Dw@12736962：`[Attached <mime>: <t>]`；video/pdf 不落 data URL 进 part.url，artifact URI 或 `inline:pdf` | attachment-placeholder.ts:39-45 | 一致 |
| 事件展示元信息 | Jxo@12748640（无 IO 推断 fileName/mime/bytes/ref） | attachments.ts:50-84 summarizeTurnAttachmentsForEvent | 一致 |
| artifact 持久化 | rie@12735669：toolCallId `attachment-${i+1}`、toolName `attachment:<mime>`、retention session；existingArtifactUri 直通 | attachment-artifacts.ts:23-77 | 一致 |
| inline 读取/水合 | Uxo@12736180：data: 直通；artifact 读回须仍为 data: | attachment-artifacts.ts:79-104 | 一致 |
| input history | c7o 投影跳过 video（13806541）；externalize 仅 image/pdf inline data:（L7a@13807466）；callId `prompt-attachment-${i+1}-${sha256[0..16]}`（F7a）；物化读回（l7o） | bootstrap/src/app/prompt-input.ts 全部对应 | 一致 |
| prompt attachment 服务面 | writePromptAttachment（`prompt-attachment:upload`，image/video/pdf prime 派生路径，14102505）、readPromptAttachment（artifact vs readBinaryFile maxBytes）、statPromptAttachment（statUnsupported/statNotFile 稳定码）、resolvePromptAttachmentPreviewSource（仅 video→local_path/chunked）、resolvePromptAttachment ref 水合（messageId+attachmentIndex→file part 的 mime/artifactUri/url，14100469） | bootstrap/src/app/create-app.ts:885-1105 逐条对应 | 一致 |
| 派生媒体路径 | NodeToolArtifactStore：image/pdf/video cache 目录、URI 级 singleflight、tmp+rename、ensure 回源校验 `%PDF-`（1561801..1565700）；projectMessagesWithMediaAttachmentPaths + `[Image/Video/PDF: source: …]`（rTo/_wa@12760500） | adapters/src/storage/index.ts:204-295、core/src/runtime/helpers/media-attachment-path.ts | 一致 |
| 聚合媒体预算 | 41943040（40MiB）+ "Media omitted from provider request"（bundle 2 处）；最新真实用户消息保护 | core/src/runtime/helpers/media-budget.ts:28（40MiB） | 一致 |
| 观测事件 | "Turn attachments resolved"/"Model request media summary"（12761241 后） | core/src/runtime/helpers/media-observability.ts | 一致 |

大小上限全集（双侧同值）：图片 20MiB、PDF 20MiB、视频 30MiB（31457280）、剪贴板图片 20MiB、剪贴板文本 1MiB、inline 文本 256KiB/2000 行。

## §2 图片链

结论：**1:1 对平**。

- magic 嗅探 `detectImageMediaType`（EPe@1224815）：PNG `89 50 4E 47`、JPEG `FF D8 FF`、GIF `GIF`、WebP RIFF..WEBP；`parseImageDataUrl` 严格 base64（长度%4≠1、字符集），jpg→jpeg 归一。我方 `contracts/src/model/image-media.ts` 逐字节一致。
- 解码/压缩引擎 = Jimp（内联 bundle，3 处 jimp 字样@3306045）：支持 bmp/gif/jpeg/png/tiff；`normalizeMediaType` 非 white-list 回落 PNG；WebP **只透传不转码**，超预算抛 `unsupported` "…cannot transcode WebP"（d3r@3307900）。
- prepareForModel 主流程（f3r@3308000）：先嗅探再信任 mediaType；原尺寸+预算内→original；否则 findFirstFittingCandidate：原尺寸保格式（PNG→png-optimized deflateLevel 9/strategy 3；JPEG→quality 阶梯 [80,60,40,20]；GIF→preserve-format）→ resize(BICUBIC scaleToFit) 保格式 → jpeg-quality → 缩放档 [.75,.5,.25] 循环 → 激进档边长 [1000,800,600,400,300,200] + quality20 jpeg-fallback。我方 `adapters/src/image/jimp-compression.ts` 阶梯/策略名/参数全部同值（JPEG_QUALITY_STEPS 等四组常量一致）。
- 预算：maxBase64Bytes=5MiB（Vz@1336843）、maxRawBytes=floor(5MiB*3/4)（rH）、maxDimension=2000（nH/Dte）、maxTokens=25e3（QO）、ratio=0.125（YQe/axs）。附件路径 prepare **不带 maxTokens**（__t@12737050），Read 图片与 PDF 页路径**带 maxTokens**（5099700/5106100）。我方 attachment-image.ts 与 read-pdf.ts 分别保持两种形态，一致。
- 本地图片附件：>20MiB→path-ref `image_too_large`；readTextFile base64→prepare→persist（ewa@12745100）。我方 attachment-media-resolver.ts:340+ 一致（INLINE_MEDIA_ATTACHMENT_MAX_BYTES=20MiB）。
- provider 出口：image part 以 `image-data{data:base64 串, mediaType}` 进 AI SDK（anthropic→base64 source，openai→data: URL；3437702/3534769）。我方 `adapters/src/model/transform.ts:196-212` 同形态（历史"URL 串→乱色"P1 已在双侧同态闭环）。
- CUA 图片 ref 识别正则 `[Attached image/[^:]+: [image #N]]`（Fko@12690500）＝我方 conversation.ts:200。

## §3 office/PDF 规格

- Read-PDF 引擎 = **Poppler 外部命令**（PopplerPdfDocumentAdapter，3315200..3315900）：
  - 页数：`pdfinfo <file>`，超时 10s，解析 `^Pages:\s+(\d+)\s*$`；
  - 渲染：`pdftoppm -jpeg -r 100 -f <first> -l <last> <file> <tmp>/page`，超时 120s，临时目录 `<tmpdir>/zcode-read-pdf-*`（我方 `drora-read-pdf-*`）；
  - 可用性：`pdftoppm -v` 探测 5s，确认后缓存；未装→"pdftoppm is not installed…"。
  - 我方 `adapters/src/pdf/index.ts` 全量一致（含同一 Broken-structure 正则与同一错误文案），并有失败不缓存可用性的修复注释（增值）。
- Read 工具 PDF 语义：无 pages——≤10 页且 ≤20MiB 原生整读（>10 页→PDF_TOO_MANY_PAGES 提示按 20 页/次分段）；带 pages——≤100MiB、区间 1-indexed、≤20 页/次，逐页 prepareForModel（带 maxTokens 25e3）后按页号排序出 image parts；错误码表 7..20（INVALID_PAGES/RANGE_TOO_LARGE/PAGES_IMAGES_UNSUPPORTED/CONFIGURATION_ERROR/INVALID/TOO_LARGE/TOO_MANY_PAGES/TIMEOUT/PASSWORD_PROTECTED/PAGE_OUT_OF_RANGE/PERMISSION_DENIED/IO_ERROR/PROCESS_FAILED）。我方 `core/src/tool/handlers/read-pdf.ts` + `contracts/src/tools/read-pdf.ts` 常量同值（10s/5s/120s、20MiB/100MiB/10/20）。
- office 四件套（docx/xlsx/pptx/pdf）运行时**无解析引擎**：bundle 内仅 (a) path-reference kind 判别 docx/xlsx/pptx/pdf/video/audio（878539），(b) artifact type 枚举 `pdf,pptx,docx,xlsx,image,html,md,text`（685229）。文档生产能力以四个**技能插件**提供（明文包 `packages/{documents,pdf,spreadsheets,presentations}-plugin`，内含 skills/env_setup，非运行时代码）。
- **REAL-GAP（本域唯一 P2）**：真值官方插件注册表默认启用 `documents(docx)/pdf/presentations(pptx)/spreadsheets(xlsx)` 四插件（category productivity、zh-CN 显示名、rootCandidates `packages/<x>-plugin`，13818427；商店排序优先级 map `pdf/presentations/spreadsheets/documents@version`，989970）。我方 `bootstrap/src/app/official-plugin-definitions.ts:98-335` 注册了 node-repl-host/android-emulator/browser-use/image-search/ios-simulator/restore-legacy-sessions/plugin-creator/skill-creator/drora-guide/computer-use，**未注册这四个**，且仓库无对应插件包源码（与批6 F2 结论吻合）。修复所需真值规格：defaultEnabled=true、category "productivity"、displayName zh-CN（Word文档/PDF/演示文档/电子表格）、icon `<CDN>/document-skills/icon.png`、candidates `packages/<documents-plugin|pdf-plugin|presentations-plugin|spreadsheets-plugin>` 及 ../ ../../ ../../../ 变体、version 以各包 package.json 为准（pdf-plugin=0.1.7）。

## §4 剪贴板

结论：**1:1 对平**（改名除外）。

- 图片读取（createNodeClipboardImageReader，14773500..14779500）：maxBytes 20MiB；mac=`osascript` 四段 AppleScript 写 `«class PNGf»` 到 `<storage>/clipboard/zcode-clipboard-*/clipboard.png` 再读；linux=wl-paste/xclip 按 png/jpeg/gif/webp 八连试，`exitCode===0 && buffer 非空且≤maxBytes` 才收；win=powershell `Get-Clipboard -Format Image`→Save PNG。存储目录 env `ZCODE_STORAGE_DIR`→`~/.zcode/clipboard`（我方 `DRORA_STORAGE_DIR`→`~/.drora/clipboard`）。我方 `apps/drora-cli/packages/cli/src/clipboard-image.ts` 逐行一致（含 appleScriptString/powershellString 转义与 runCommandBuffer 超限 kill）。
- 文本写入（createNodeClipboardTextWriter，14779500..14781000）：1MiB 上限（"Clipboard text exceeds N bytes."）；OSC52 `\x1b]52;c;<b64>\x07` + native（pbcopy / wl-copy / xclip -selection clipboard / xsel --clipboard --input / powershell `Set-Clipboard -Value ([Console]::In.ReadToEnd())`），两路全败抛错。我方 `clipboard-text.ts` 一致。
- 粘贴文本长文链：sourceKind "clipboard-text" 附件 resolve 时走 `deferred_clipboard_text` path-ref 不进 prompt（真值 owa 分支＝我方 attachments.ts:245-255）。

## §5 差集三分类

| # | 分类 | 等级 | 项 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | REAL-GAP | P2 | 四个 office 技能插件（documents/pdf/presentations/spreadsheets）真值默认启用注册＋源码包，我方注册表与仓库均缺 | 真值 offset 13818427、989970；我方 bootstrap/src/app/official-plugin-definitions.ts:98-335 |
| 2 | SHAPE-DIFF | P3 | artifact URI scheme `zcode-artifact://` ↔ `drora-artifact://`（有意产品改名，全链自洽） | 真值 1561300 附近；我方 adapters/src/storage/index.ts:82 |
| 3 | SHAPE-DIFF | P3 | 临时目录/环境前缀 `zcode-clipboard-`/`zcode-read-pdf-`/`ZCODE_STORAGE_DIR` ↔ `drora-*`/`DRORA_STORAGE_DIR` | 真值 14773600、3315400；我方 clipboard-image.ts:33、pdf/index.ts:65 |
| 4 | SHAPE-DIFF | P3 | 错误类型名 `ZCodeAttachmentFaultError` ↔ `DroraAttachmentFaultError`（码集 statUnsupported/statNotFile 相同） | 真值 1277xxxx（bundle 词频 2）；我方 create-app.ts:1053 |
| 5 | EXTRA | P3 | 我方 Read-PDF 外层工具超时 `READ_PDF_TOOL_TIMEOUT_MS = 渲染 120s + 30s` 及 resolveReadTimeoutBudgetMs；真值仅见子进程级 timeoutMs（120s/10s/5s），未见对应外层预算 | 我方 core/src/tool/handlers/read-pdf.ts:49-51、81-91 |

REAL-GAP 1 项（P2×1）、EXTRA 1 项（P3×1）、SHAPE-DIFF 3 项（P3×3）。**无 P1**。本域核心运行链（解析/降级码/上限/引擎/命令/文案/正则/观测）与真值 0.16.9 逐点对平。

## §6 OPEN-QUESTION

1. OQ-1：真值 Poppler adapter 产生 password_protected/page_out_of_range 等细分类的实现在 bundle 内未直接定位（错误码映射表 ZQs 存在）；我方分类是超集还是同构待反编译确认（不影响行为对拍结论：ReadErrorCode 表双侧同值）。
2. OQ-2：真值协议层 prompt attachment union 存在两形态——导出表 `Flr`（无 strict、无 audio，835427）与内联版（strict+audio，807229）；我方采用 strict+audio 版。哪一形态实际挂接 message.attachments 未终验；若真值运行时用 Flr，则我方 audio/strict 为安全超集（strict 更严，audio 为增量）。
3. OQ-3：office 四插件在真值安装后对 prompt 链的附加行为（如技能可用性注入）未纳入本域；建议修复 REAL-GAP#1 时以明文包 skills/ 目录为规格源逐包移植。
