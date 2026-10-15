import { existsSync, statSync, type Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import type { Command } from "./types.ts";

export const DEFAULT_FILE_SERVER_PORT = 13131;

export interface ParsedFileServerArgs {
  readonly dir: string;
  readonly port: number;
  readonly error?: string;
}

/** `[dir] [-p <port>]`; also accepts `--port <port>`, `-p=<port>` and `--port=<port>`. */
export function parseFileServerArgs(
  args: readonly string[],
  cwd = process.cwd(),
): ParsedFileServerArgs {
  const base = resolve(cwd);
  let dir = base;
  let port = DEFAULT_FILE_SERVER_PORT;
  let seenDir = false;

  const fail = (error: string): ParsedFileServerArgs => ({ dir, port, error });

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    // Forwarded by the dispatcher when it precedes the command name; this command has no editor.
    if (arg === "-e" || arg === "--edit") continue;

    const inline = /^(?:-p|--port)=(.*)$/.exec(arg)?.[1];
    if (arg === "-p" || arg === "--port" || inline !== undefined) {
      let value = inline;
      if (value === undefined) {
        index += 1;
        value = args[index];
      }
      if (value === undefined || value === "") return fail(`Missing value for ${arg}`);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return fail(`Invalid port "${value}": expected an integer in 0..65535`);
      }
      port = parsed;
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") return fail(`Unknown option "${arg}"`);
    if (seenDir) return fail(`Unexpected argument "${arg}": only one directory is supported`);
    seenDir = true;
    dir = resolve(base, arg);
  }

  return { dir, port };
}

/** Absolute path for a request path that stays inside `rootDir`; `null` for malformed or escaping paths. */
export function resolveSafePath(rootDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const root = resolve(rootDir);
  // "." keeps an absolute-looking path relative to the root instead of the filesystem.
  const resolved = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  return resolved === root || resolved.startsWith(root + sep) ? resolved : null;
}

/** An unused path for an upload: basename-only, with ` (1)`, ` (2)`, … appended when taken. */
export function resolveUniqueFilePath(dir: string, rawName: string): string | null {
  const name = basename(rawName.replaceAll("\\", "/")).trim();
  if (!name || name === "." || name === ".." || name.includes("\0")) return null;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(dir, name);
  for (let n = 1; existsSync(candidate); n += 1) candidate = join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

interface DirectoryEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly size: number;
  readonly mtime: number;
}

/** `throwIfNoEntry` still throws when a parent is a file, so every stat goes through this. */
function tryStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanSize(bytes: number): string {
  let value = bytes;
  let unit = "B";
  for (const next of ["KB", "MB", "GB", "TB"]) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return unit === "B" ? `${bytes} B` : `${value.toFixed(1)} ${unit}`;
}

function renderDirectoryPage(
  root: string,
  pathname: string,
  dir: string,
  entries: readonly DirectoryEntry[],
): string {
  const trimmed = pathname.replace(/\/+$/, "");
  const base = `${trimmed}/`;
  const rel = relative(root, dir);
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/") + 1) || "/";

  const rows = entries
    .map((entry) => {
      const href = `${base}${encodeURIComponent(entry.name)}${entry.dir ? "/" : ""}`;
      const download = entry.dir
        ? ""
        : ` <a class="dl" href="${escapeHtml(href)}?download=1">download</a>`;
      return `<tr>
<td class="name"><a href="${escapeHtml(href)}">${entry.dir ? "📁 " : "📄 "}${escapeHtml(entry.name)}${entry.dir ? "/" : ""}</a></td>
<td class="size">${entry.dir ? "—" : humanSize(entry.size)}</td>
<td class="mtime">${escapeHtml(new Date(entry.mtime).toLocaleString())}</td>
<td class="actions"><a href="${escapeHtml(href)}">view</a>${download}</td>
</tr>`;
    })
    .join("\n");

  const parentRow =
    rel === ""
      ? ""
      : `<tr><td class="name"><a href="${escapeHtml(parent)}">📁 ../</a></td><td class="size">—</td><td class="mtime">—</td><td class="actions">—</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`/${rel}`)} — lgnh file-server</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 1rem; font: 15px/1.5 system-ui, sans-serif; }
h1 { font-size: 1.1rem; margin: 0; word-break: break-all; }
.root { margin: .25rem 0 1rem; opacity: .6; font-size: .8rem; word-break: break-all; }
.card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .6rem; padding: .75rem; margin-bottom: 1rem; }
.card h2 { margin: 0 0 .5rem; font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
.drop { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.drop.over { outline: 2px dashed currentColor; outline-offset: .25rem; }
.drop input { flex: 1 1 16rem; min-width: 0; }
button { padding: .4rem .9rem; border-radius: .4rem; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
.status { flex: 1 1 100%; margin: 0; font-size: .8rem; opacity: .7; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .35rem .4rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
th { font-size: .75rem; text-transform: uppercase; opacity: .6; }
td.name { word-break: break-all; }
td.size, td.mtime, td.actions { white-space: nowrap; font-size: .85rem; opacity: .85; }
a { color: inherit; }
@media (max-width: 40rem) { td.mtime, th.mtime { display: none; } }
</style>
</head>
<body>
<header>
<h1>/${escapeHtml(rel)}</h1>
<p class="root">${escapeHtml(root)}</p>
</header>
<main>
<section class="card">
<h2>Upload</h2>
<form method="post" enctype="multipart/form-data" action="${escapeHtml(pathname)}">
<div id="drop" class="drop">
<input id="files" type="file" name="file" multiple>
<button type="submit">Upload</button>
<p id="status" class="status">Drag files here, or pick them and press Upload.</p>
</div>
</form>
</section>
<section class="card">
<table>
<thead><tr><th>Name</th><th class="size">Size</th><th class="mtime">Modified</th><th>Links</th></tr></thead>
<tbody>
${parentRow}
${rows}
</tbody>
</table>
</section>
</main>
<script>
(function () {
  var zone = document.getElementById('drop');
  var input = document.getElementById('files');
  var status = document.getElementById('status');
  function upload(files) {
    if (!files || !files.length) return;
    var body = new FormData();
    for (var i = 0; i < files.length; i += 1) body.append('file', files[i]);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', location.pathname);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) status.textContent = Math.round((event.loaded / event.total) * 100) + '%';
    };
    xhr.onload = function () {
      if (xhr.status !== 201) { status.textContent = 'Upload failed (' + xhr.status + ')'; return; }
      status.textContent = 'Uploaded ' + JSON.parse(xhr.responseText).uploaded.length + ' file(s).';
      setTimeout(function () { location.reload(); }, 400);
    };
    xhr.onerror = function () { status.textContent = 'Upload failed'; };
    xhr.send(body);
  }
  zone.addEventListener('dragover', function (event) { event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
  zone.addEventListener('drop', function (event) {
    event.preventDefault();
    zone.classList.remove('over');
    upload(event.dataTransfer.files);
  });
  input.addEventListener('change', function () { upload(input.files); });
})();
</script>
</body>
</html>
`;
}

export interface FileServerOptions {
  readonly rootDir: string;
  readonly port: number;
  readonly hostname?: string;
  readonly onLog?: (line: string) => void;
}

export function startFileServer(options: FileServerOptions): Bun.Server<undefined> {
  const root = resolve(options.rootDir);
  const log = options.onLog ?? (() => {});

  const server = Bun.serve({
    port: options.port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      if (req.method === "GET" || req.method === "HEAD") log(`${req.method} ${url.pathname}`);
      try {
        if (req.method === "GET" || req.method === "HEAD") return await serveRead(req, url);
        if (req.method === "POST") return await serveUpload(req, url);
        if (req.method === "PUT") return await servePut(req, url);
      } catch (error) {
        log(`error: ${error instanceof Error ? error.message : String(error)}`);
        return new Response("Internal Server Error\n", { status: 500 });
      }
      return new Response("Method Not Allowed\n", {
        status: 405,
        headers: { Allow: "GET, HEAD, POST, PUT" },
      });
    },
  });

  async function serveRead(req: Request, url: URL): Promise<Response> {
    try {
      decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request\n", { status: 400 });
    }
    const resolved = resolveSafePath(root, url.pathname);
    if (!resolved) return new Response("Forbidden\n", { status: 403 });

    const stats = tryStat(resolved);
    if (!stats) return new Response("Not Found\n", { status: 404 });
    const head = req.method === "HEAD";

    if (stats.isDirectory()) {
      const dirents = await readdir(resolved, { withFileTypes: true });
      const entries: DirectoryEntry[] = [];
      for (const dirent of dirents) {
        const entryStats = tryStat(join(resolved, dirent.name));
        if (!entryStats) continue;
        entries.push({
          name: dirent.name,
          dir: entryStats.isDirectory(),
          size: entryStats.size,
          mtime: entryStats.mtimeMs,
        });
      }
      entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      const html = renderDirectoryPage(root, url.pathname, resolved, entries);
      return new Response(head ? null : html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!stats.isFile()) return new Response("Not Found\n", { status: 404 });

    const headers = new Headers();
    if (url.searchParams.get("download") === "1") {
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(basename(resolved))}`,
      );
    }
    if (head) headers.set("Content-Length", String(stats.size));
    return new Response(head ? null : Bun.file(resolved), { status: 200, headers });
  }

  async function serveUpload(req: Request, url: URL): Promise<Response> {
    const target = resolveSafePath(root, url.pathname);
    if (!target) return new Response("Forbidden\n", { status: 403 });
    if (!tryStat(target)?.isDirectory()) {
      return new Response("Not Found\n", { status: 404 });
    }

    const files: File[] = [];
    try {
      const form = await req.formData();
      form.forEach((value) => {
        if (typeof value === "object" && value !== null && "name" in value && value.name !== "") {
          files.push(value as File);
        }
      });
    } catch {
      return new Response("Bad Request\n", { status: 400 });
    }
    if (files.length === 0) return new Response("No files\n", { status: 400 });

    const uploaded: string[] = [];
    for (const file of files) {
      const unique = resolveUniqueFilePath(target, file.name);
      if (!unique) continue;
      await Bun.write(unique, file);
      uploaded.push(basename(unique));
    }
    log(`POST ${url.pathname} (${uploaded.join(", ")})`);

    if (req.headers.get("accept")?.includes("application/json")) {
      return Response.json({ uploaded }, { status: 201 });
    }
    return new Response(null, { status: 303, headers: { Location: url.pathname } });
  }

  async function servePut(req: Request, url: URL): Promise<Response> {
    const target = resolveSafePath(root, url.pathname);
    if (!target) return new Response("Forbidden\n", { status: 403 });
    const parent = dirname(target);
    if (!tryStat(parent)?.isDirectory()) {
      return new Response("Not Found\n", { status: 404 });
    }
    const unique = resolveUniqueFilePath(parent, basename(target));
    if (!unique) return new Response("Bad Request\n", { status: 400 });
    await Bun.write(unique, req);
    const saved = basename(unique);
    log(`PUT ${url.pathname} (${saved})`);
    return new Response(`Uploaded ${saved}\n`, { status: 201 });
  }

  return server;
}

function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) addresses.push(info.address);
    }
  }
  return addresses;
}

export const fileServerCommand: Command = {
  names: ["file-server"],
  help: "  lgnh file-server [dir] [-p <port>]  serve directory with HTTP upload/download (default: 13131)",
  async run({ args }, _env): Promise<void> {
    const { dir, port, error } = parseFileServerArgs(args);
    if (error) {
      console.error(error);
      process.exitCode = 1;
      return;
    }
    if (!tryStat(dir)?.isDirectory()) {
      console.error(`Not a directory: ${dir}`);
      process.exitCode = 1;
      return;
    }

    const server = startFileServer({
      rootDir: dir,
      port,
      hostname: "0.0.0.0",
      onLog: (line) => console.log(line),
    });

    console.log(`Serving ${dir}`);
    console.log(`Local:   http://localhost:${server.port}/`);
    for (const address of lanAddresses()) {
      console.log(`Network: http://${address}:${server.port}/`);
    }
    console.log("Press Ctrl+C to stop");

    await new Promise<void>((stopped) => {
      const stop = (): void => {
        void server.stop(true).then(() => stopped());
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  },
};
