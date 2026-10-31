import { createFileSystemError, type FileSystemPort } from "@drora/contracts";

export class MemoryFileSystem implements FileSystemPort {
  // 修复：Windows 上 node fs 把 "/" 与 "\" 视为同一文件，而这个替身按原始字符串做键，
  // 生产代码经 normalize/resolve 后传入的反斜杠路径会与测试用正斜杠播种的键错开。
  // 请求侧统一归一为正斜杠键，保持与生产 fs 语义一致（响应仍回显原始请求路径）。
  private key(path: string): string {
    return path.replaceAll("\\", "/");
  }

  readonly createdDirectories = new Set<string>();
  readonly readRequests: Array<{ maxBytes?: number; path: string }> = [];
  readonly searchFileRequests: Array<{ maxResults?: number; path: string; pattern: string }> = [];

  constructor(
    files: Record<string, string>,
    private readonly fileMtimes: Readonly<Record<string, number>> = {},
  ) {
    // 播种键同样归一为正斜杠：测试用 join/resolve 构造的键与请求侧形态才能对上。
    this.files = Object.fromEntries(
      Object.entries(files).map(([path, content]) => [this.key(path), content]),
    );
  }

  readonly files: Record<string, string>;

  async createDirectory(request: { path: string }) {
    this.createdDirectories.add(this.key(request.path));
    return { path: request.path };
  }

  async stat(request: { path: string }) {
    if (this.createdDirectories.has(this.key(request.path))) {
      return { kind: "directory" as const, path: request.path, sizeBytes: 0 };
    }
    const content = this.files[this.key(request.path)];
    if (content === undefined) throw missingFile(request.path);
    return {
      kind: "file" as const,
      path: request.path,
      sizeBytes: Buffer.byteLength(content),
      mtimeMs: this.fileMtimes[request.path],
    };
  }

  async readTextFile(request: { path: string; encoding?: BufferEncoding; maxBytes?: number }) {
    this.readRequests.push({ maxBytes: request.maxBytes, path: request.path });
    const content = this.files[this.key(request.path)];
    if (content === undefined) throw missingFile(request.path);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const maxBytes = request.maxBytes ?? sizeBytes;
    const truncated = sizeBytes > maxBytes;
    const returned = truncated ? content.slice(0, maxBytes) : content;
    return {
      bytesRead: Buffer.byteLength(returned, "utf8"),
      content: returned,
      encoding: request.encoding ?? "utf8",
      path: request.path,
      sizeBytes,
      truncated,
    };
  }

  async readBinaryFile(request: { path: string; maxBytes?: number }) {
    this.readRequests.push({ maxBytes: request.maxBytes, path: request.path });
    const content = this.files[this.key(request.path)];
    if (content === undefined) throw missingFile(request.path);
    const buffer = Buffer.from(content, "utf8");
    if (request.maxBytes !== undefined && buffer.byteLength > request.maxBytes) {
      throw createFileSystemError({
        code: "too_large",
        path: request.path,
        message: `File content (${buffer.byteLength}B) exceeds maximum allowed size (${request.maxBytes}B).`,
      });
    }
    return {
      bytesRead: buffer.byteLength,
      content: buffer,
      path: request.path,
      sizeBytes: buffer.byteLength,
    };
  }

  async readTextFileRange(request: {
    path: string;
    encoding?: BufferEncoding;
    offsetLine?: number;
    limitLines?: number;
    maxBytes?: number;
  }) {
    this.readRequests.push({ maxBytes: request.maxBytes, path: request.path });
    const content = this.files[this.key(request.path)];
    if (content === undefined) throw missingFile(request.path);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (request.maxBytes !== undefined && sizeBytes > request.maxBytes) {
      throw createFileSystemError({
        code: "too_large",
        path: request.path,
        message: `File content (${sizeBytes}B) exceeds maximum allowed size (${request.maxBytes}B). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
      });
    }
    const lines = content.length === 0 ? [] : content.split(/\r?\n/);
    const offsetLine = Math.max(0, Math.trunc(request.offsetLine ?? 0));
    const limitLines =
      request.limitLines === undefined ? undefined : Math.max(0, Math.trunc(request.limitLines));
    const selected =
      limitLines === undefined
        ? lines.slice(offsetLine)
        : lines.slice(offsetLine, offsetLine + limitLines);
    return {
      bytesRead: sizeBytes,
      content: selected.join("\n"),
      encoding: request.encoding ?? "utf8",
      lineCount: selected.length,
      path: request.path,
      sizeBytes,
      startLine: offsetLine + 1,
      totalLines: lines.length,
      truncated: false,
    };
  }

  async writeTextFile(request: { content: string; path: string }) {
    this.files[this.key(request.path)] = request.content;
    return { bytesWritten: Buffer.byteLength(request.content, "utf8"), path: request.path };
  }

  async removeFile(request: { missingOk?: boolean; path: string }) {
    const existed = this.files[this.key(request.path)] !== undefined;
    if (!existed && request.missingOk !== true) throw missingFile(request.path);
    delete this.files[this.key(request.path)];
    return { path: request.path, removed: existed };
  }

  async listDirectory(request: { path: string }) {
    const prefix = `${this.key(request.path).replace(/\/+$/, "")}/`;
    const seen = new Set<string>();
    const entries = Object.keys(this.files).flatMap((path) => {
      if (!path.startsWith(prefix)) return [];
      const rest = path.slice(prefix.length);
      const [name] = rest.split("/");
      if (!name || seen.has(name)) return [];
      seen.add(name);
      const isDirectory = rest.includes("/");
      return [
        {
          kind: isDirectory ? ("directory" as const) : ("file" as const),
          name,
          path: `${prefix}${name}`,
        },
      ];
    });
    return {
      durationMs: 0,
      entries,
      numEntries: entries.length,
      path: request.path,
    };
  }

  async searchFiles(request: { maxResults?: number; path: string; pattern: string }) {
    this.searchFileRequests.push({
      maxResults: request.maxResults,
      path: request.path,
      pattern: request.pattern,
    });
    const prefix = `${this.key(request.path).replace(/\/+$/, "")}/`;
    const files = Object.keys(this.files)
      .filter((path) => path.startsWith(prefix))
      .filter((path) => !path.slice(prefix.length).includes("/"))
      .filter((path) => (request.pattern === "*.md" ? path.endsWith(".md") : true))
      .slice(0, request.maxResults);
    return {
      durationMs: 0,
      files,
      numFiles: files.length,
      path: request.path,
      pattern: request.pattern,
      truncated: false,
    };
  }

  async searchText(request: {
    outputMode?: "content" | "files_with_matches" | "count";
    path: string;
    pattern: string;
  }) {
    return {
      durationMs: 0,
      entries: [],
      files: [],
      mode: request.outputMode ?? "files_with_matches",
      numMatches: 0,
      path: request.path,
      pattern: request.pattern,
      truncated: false,
    };
  }
}

function missingFile(path: string): Error {
  return createFileSystemError({ code: "not_found", message: `missing: ${path}`, path });
}
