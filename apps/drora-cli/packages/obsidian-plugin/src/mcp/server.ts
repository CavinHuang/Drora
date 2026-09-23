import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import { configureManagedVault, configureVaultAt, listCandidates, loadVaultConfig, vaultSummary } from "../lib/config.js";
import { managedVaultDirPath } from "../lib/discovery.js";
import { createVaultFileSystem } from "../lib/vault-fs.js";
import { guard, json } from "../lib/result.js";
import type { VaultConfig } from "../lib/config.js";

const PLUGIN_VERSION = "0.1.0";

/** 插件数据目录：manifest env 注入；缺失时回落到用户目录（本地直跑 server 时可用）。 */
function pluginDataDir(): string {
  const configured = process.env.OBSIDIAN_PLUGIN_DATA?.trim();
  if (configured) return resolve(configured);
  return resolve(homedir(), ".drora", "obsidian-plugin-data");
}

async function requireVaultConfig(): Promise<VaultConfig> {
  const config = await loadVaultConfig(pluginDataDir());
  if (!config) {
    throw new Error("尚未配置 Vault：先调用 obsidian_configure_vault 授权一个根目录（或配置托管 Vault）");
  }
  return config;
}

async function requireConfiguredVault() {
  const config = await requireVaultConfig();
  return { config, vault: createVaultFileSystem(config.rootPath) };
}

/** 写入门控：allowAgentWrites 是 Agent 发起写入的唯一许可，读操作不受限。 */
async function requireWritableVault() {
  const { config, vault } = await requireConfiguredVault();
  if (!config.allowAgentWrites) {
    throw new Error(
      "当前 Vault 未开启 Agent 写入：请重新运行 obsidian_configure_vault 并设 allow_agent_writes=true",
    );
  }
  return { config, vault };
}

const server = new McpServer({ name: "obsidian", version: PLUGIN_VERSION });

server.registerTool(
  "obsidian_status",
  {
    title: "Obsidian Status",
    description:
      "Show the configured Obsidian Vault (if any) and discoverable candidates, including the plugin-managed Vault. Call this first to see what is available.",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const dataDir = pluginDataDir();
      await mkdir(dataDir, { recursive: true });
      const config = await loadVaultConfig(dataDir);
      const candidates = await listCandidates(dataDir);
      return json({
        configured: config ? vaultSummary(config) : null,
        managedVaultPath: managedVaultDirPath(dataDir),
        candidates,
      });
    }),
);

server.registerTool(
  "obsidian_configure_vault",
  {
    title: "Configure Obsidian Vault",
    description:
      "Authorize and select the active Vault. Pass root_path of a discovered candidate, or managed=true to use the plugin-managed Vault. Set allow_agent_writes=true to enable note creation and edits.",
    inputSchema: {
      root_path: z.string().optional().describe("Absolute path of the Vault root to authorize (from obsidian_status candidates)."),
      managed: z.boolean().optional().describe("Configure the plugin-managed Vault instead of an Obsidian-registered one."),
      display_name: z.string().optional().describe("Optional display name; defaults to the folder name (managed Vault: 'Drora Vault')."),
      inbox_path: z.string().optional().describe("Vault-relative folder for new untitled notes. Default: 'Inbox'."),
      allow_agent_writes: z.boolean().optional().describe("Allow the agent to create, edit, rename, and delete notes. Default false (read-only)."),
    },
  },
  async (args) =>
    guard(async () => {
      const dataDir = pluginDataDir();
      await mkdir(dataDir, { recursive: true });
      const options = {
        displayName: args.display_name,
        inboxPath: args.inbox_path,
        allowAgentWrites: args.allow_agent_writes === true,
      };
      const summary = args.managed
        ? await configureManagedVault(dataDir, options)
        : await configureVaultAt(dataDir, args.root_path ?? "", options);
      return json({ configured: summary });
    }),
);

server.registerTool(
  "obsidian_list_files",
  {
    title: "List Vault Files",
    description:
      "List folders and Markdown notes in the configured Vault (bounded: max depth 16, 5000 notes, 1000 folders; hidden entries and symlinks are skipped).",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const { config, vault } = await requireConfiguredVault();
      return json({ vault: vaultSummary(config), entries: await vault.listFiles() });
    }),
);

server.registerTool(
  "obsidian_read_file",
  {
    title: "Read Vault Note",
    description:
      "Read a Markdown note from the Vault. Returns content, sha256 (pass back as expected_sha256 to update safely), and modified time. Max 2 MB.",
    inputSchema: {
      relative_path: z.string().min(1).describe("Vault-relative .md path, e.g. 'Notes/idea.md'."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireConfiguredVault();
      return json(await vault.readFile(args.relative_path));
    }),
);

server.registerTool(
  "obsidian_write_file",
  {
    title: "Write Vault Note",
    description:
      "Create or update a Markdown note. For updates pass expected_sha256 from the last read; on mismatch a conflict result with the current sha256 is returned instead of overwriting. Max 2 MB.",
    inputSchema: {
      relative_path: z.string().min(1).describe("Vault-relative .md path."),
      content: z.string().describe("Full Markdown content to write."),
      expected_sha256: z.string().optional().describe("sha256 of the note as previously read; mismatch yields a conflict result."),
      create_only: z.boolean().optional().describe("Fail when the note already exists instead of updating."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireWritableVault();
      return json(
        await vault.writeFile({
          relativePath: args.relative_path,
          content: args.content,
          expectedSha256: args.expected_sha256,
          createOnly: args.create_only,
        }),
      );
    }),
);

server.registerTool(
  "obsidian_create_note",
  {
    title: "Create Untitled Note",
    description:
      "Create a new note with an exclusive 'Untitled YYYY-MM-DD[ N].md' name in the Vault Inbox (default) or a given folder; never overwrites existing notes.",
    inputSchema: {
      folder_path: z.string().optional().describe("Vault-relative folder; omit to create in the configured Inbox."),
      content: z.string().optional().describe("Initial Markdown content; default empty."),
    },
  },
  async (args) =>
    guard(async () => {
      const { config, vault } = await requireWritableVault();
      const result = args.folder_path
        ? await vault.createUntitledNoteInFolder(args.folder_path, args.content ?? "")
        : await vault.createUntitledNote(config.inboxPath, args.content ?? "");
      return json(result);
    }),
);

server.registerTool(
  "obsidian_create_folder",
  {
    title: "Create Vault Folder",
    description: "Create a folder in the Vault. The parent folder must already exist; the root cannot be recreated.",
    inputSchema: {
      relative_path: z.string().min(1).describe("Vault-relative folder path to create, e.g. 'Projects/2026'."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireWritableVault();
      await vault.createFolder(args.relative_path);
      return json({ ok: true, relativePath: args.relative_path });
    }),
);

server.registerTool(
  "obsidian_rename_file",
  {
    title: "Rename Vault Note",
    description:
      "Rename a Markdown note within its folder. A trailing .md is added automatically; optional expected_sha256 guards against concurrent edits.",
    inputSchema: {
      relative_path: z.string().min(1).describe("Vault-relative .md path of the note to rename."),
      name: z.string().min(1).describe("New file name without folder (with or without .md)."),
      expected_sha256: z.string().optional().describe("sha256 of the note as previously read."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireWritableVault();
      return json(
        await vault.renameFile({ relativePath: args.relative_path, name: args.name, expectedSha256: args.expected_sha256 }),
      );
    }),
);

server.registerTool(
  "obsidian_delete_file",
  {
    title: "Delete Vault Note",
    description:
      "Delete a Markdown note. Pass expected_sha256 from the last read to refuse deletion when the note changed externally.",
    inputSchema: {
      relative_path: z.string().min(1).describe("Vault-relative .md path to delete."),
      expected_sha256: z.string().optional().describe("sha256 of the note as previously read."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireWritableVault();
      await vault.deleteFile({ relativePath: args.relative_path, expectedSha256: args.expected_sha256 });
      return json({ ok: true, relativePath: args.relative_path });
    }),
);

server.registerTool(
  "obsidian_resolve_media",
  {
    title: "Resolve Vault Media",
    description:
      "Resolve a note-embedded image/media reference (vault-relative or file: URL) to an absolute path inside the Vault, so it can be read. Returns null when it points outside the Vault or does not exist.",
    inputSchema: {
      note_relative_path: z.string().min(1).describe("Vault-relative .md path of the containing note."),
      src: z.string().min(1).describe("Embedding source as written in the note, e.g. 'assets/photo.png'."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireConfiguredVault();
      return json({ path: await vault.resolveMedia(args.note_relative_path, args.src) });
    }),
);

server.registerTool(
  "obsidian_save_pasted_image",
  {
    title: "Save Image Into Vault",
    description:
      "Save base64 image data (png/jpeg/gif/webp, magic-byte validated, max 10 MB) next to a note under assets/ and return the note-relative src for embedding.",
    inputSchema: {
      note_relative_path: z.string().min(1).describe("Vault-relative .md path of the note the image belongs to."),
      mime_type: z.string().min(1).describe("image/png, image/jpeg, image/gif, or image/webp."),
      base64: z.string().min(1).describe("Base64-encoded image bytes."),
    },
  },
  async (args) =>
    guard(async () => {
      const { vault } = await requireWritableVault();
      const result = await vault.savePastedImage({
        noteRelativePath: args.note_relative_path,
        mimeType: args.mime_type,
        base64: args.base64,
      });
      if (!result) throw new Error("图片数据非法：需要受支持 MIME 的真实图片字节（≤10MB）");
      return json(result);
    }),
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

// Node 没有 import.meta.main（那是 Deno/Bun 的 API）；仓库入口判定惯例是
// pathToFileURL 比对（见 node-repl-host/scripts/build.mjs 同款写法）。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
