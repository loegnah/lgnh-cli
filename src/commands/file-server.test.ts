import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_FILE_SERVER_PORT,
  parseFileServerArgs,
  resolveSafePath,
  resolveUniqueFilePath,
  startFileServer,
} from "./file-server.ts";

const sandboxes: string[] = [];
const servers: Bun.Server<undefined>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Temp root with `file.txt`, `sub/nested.txt` and a running server on an ephemeral port. */
async function serveFixture(): Promise<{ base: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lgnh-file-server-"));
  sandboxes.push(dir);
  writeFileSync(join(dir, "file.txt"), "hello file-server");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "nested.txt"), "nested");

  const server = startFileServer({ rootDir: dir, port: 0, hostname: "127.0.0.1" });
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, dir };
}

test("parseFileServerArgs defaults to port 13131 and the working directory", () => {
  const parsed = parseFileServerArgs([], "/tmp/lgnh-base");
  expect(parsed.error).toBeUndefined();
  expect(parsed.port).toBe(DEFAULT_FILE_SERVER_PORT);
  expect(parsed.dir).toBe(resolve("/tmp/lgnh-base"));
});

test("parseFileServerArgs accepts every port spelling plus one directory", () => {
  for (const flags of [["-p", "8080"], ["--port", "8080"], ["-p=8080"], ["--port=8080"]]) {
    const parsed = parseFileServerArgs(flags, "/tmp/lgnh-base");
    expect(parsed.error).toBeUndefined();
    expect(parsed.port).toBe(8080);
  }

  const custom = parseFileServerArgs(["public", "--port", "0"], "/tmp/lgnh-base");
  expect(custom.error).toBeUndefined();
  expect(custom.port).toBe(0);
  expect(custom.dir).toBe(join(resolve("/tmp/lgnh-base"), "public"));

  // The dispatcher forwards a leading edit flag; this command has no editor to open.
  expect(parseFileServerArgs(["-e"], "/tmp/lgnh-base").error).toBeUndefined();
});

test("parseFileServerArgs rejects bad ports, unknown flags and extra directories", () => {
  for (const args of [
    ["-p"],
    ["--port"],
    ["-p", "abc"],
    ["--port", "1.5"],
    ["-p", "65536"],
    ["--port=-1"],
    ["--port="],
    ["--bogus"],
    ["two", "dirs"],
  ]) {
    expect(parseFileServerArgs(args, "/tmp/lgnh-base").error).toBeDefined();
  }
});

test("resolveSafePath keeps requests inside the root", () => {
  const root = "/tmp/lgnh-root";
  expect(resolveSafePath(root, "/")).toBe(root);
  expect(resolveSafePath(root, "/sub/file.txt")).toBe(join(root, "sub", "file.txt"));
  expect(resolveSafePath(root, "/sub%20dir/a%20b.txt")).toBe(join(root, "sub dir", "a b.txt"));

  for (const pathname of [
    "/../etc/passwd",
    "/%2e%2e/secret",
    "/..%2f..%2fetc%2fpasswd",
    "/%zz",
    "/bad%00name",
  ]) {
    expect(resolveSafePath(root, pathname)).toBeNull();
  }
});

test("resolveUniqueFilePath sanitizes names and never overwrites", () => {
  const root = mkdtempSync(join(tmpdir(), "lgnh-unique-"));
  sandboxes.push(root);
  writeFileSync(join(root, "taken.txt"), "original");

  expect(resolveUniqueFilePath(root, "../../escape.txt")).toBe(join(root, "escape.txt"));
  expect(resolveUniqueFilePath(root, "windows\\style.txt")).toBe(join(root, "style.txt"));
  expect(resolveUniqueFilePath(root, "taken.txt")).toBe(join(root, "taken (1).txt"));
  writeFileSync(join(root, "taken (1).txt"), "second");
  expect(resolveUniqueFilePath(root, "taken.txt")).toBe(join(root, "taken (2).txt"));

  for (const name of ["", "  ", ".", ".."]) expect(resolveUniqueFilePath(root, name)).toBeNull();
});

test("GET / lists directories and files as HTML", async () => {
  const { base } = await serveFixture();

  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("file.txt");
  expect(html).toContain("sub/");
  expect(html).toContain('type="file"');
  expect(html).toContain("upload");
  expect(html).toContain("17 B");
  expect(html).not.toContain("../");

  const nested = await fetch(`${base}/sub/`);
  expect(nested.status).toBe(200);
  const nestedHtml = await nested.text();
  expect(nestedHtml).toContain("nested.txt");
  expect(nestedHtml).toContain("../");

  const head = await fetch(`${base}/`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");

  expect((await fetch(`${base}/missing.txt`)).status).toBe(404);
  expect((await fetch(`${base}/file.txt/nope`)).status).toBe(404);
});

test("GET /file.txt streams the bytes and ?download=1 attaches it", async () => {
  const { base } = await serveFixture();

  const plain = await fetch(`${base}/file.txt`);
  expect(plain.status).toBe(200);
  expect(await plain.text()).toBe("hello file-server");
  expect(plain.headers.get("content-disposition")).toBeNull();

  const download = await fetch(`${base}/file.txt?download=1`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''file.txt");
  expect(await download.text()).toBe("hello file-server");

  const head = await fetch(`${base}/file.txt`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("17");
  expect(await head.text()).toBe("");
});

test("POST / uploads single, multiple and duplicate names without overwriting", async () => {
  const { base, dir } = await serveFixture();

  const single = new FormData();
  single.set("file", new File(["one"], "dup.txt"));
  const first = await fetch(`${base}/`, {
    method: "POST",
    body: single,
    headers: { Accept: "application/json" },
  });
  expect(first.status).toBe(201);
  expect(await first.json()).toEqual({ uploaded: ["dup.txt"] });

  const again = new FormData();
  again.set("file", new File(["two"], "dup.txt"));
  const second = await fetch(`${base}/`, {
    method: "POST",
    body: again,
    headers: { Accept: "application/json" },
  });
  expect(second.status).toBe(201);
  const secondBody = (await second.json()) as { uploaded: string[] };
  expect(secondBody.uploaded).toEqual(["dup (1).txt"]);
  expect(readFileSync(join(dir, "dup.txt"), "utf-8")).toBe("one");
  expect(readFileSync(join(dir, "dup (1).txt"), "utf-8")).toBe("two");

  const multi = new FormData();
  multi.append("file", new File(["a"], "a.txt"));
  multi.append("file", new File(["b"], "b.txt"));
  const many = await fetch(`${base}/`, {
    method: "POST",
    body: multi,
    headers: { Accept: "application/json" },
  });
  expect(many.status).toBe(201);
  const manyBody = (await many.json()) as { uploaded: string[] };
  expect(manyBody.uploaded).toEqual(["a.txt", "b.txt"]);

  const nested = new FormData();
  nested.set("file", new File(["deep"], "deep.txt"));
  const intoSub = await fetch(`${base}/sub/`, {
    method: "POST",
    body: nested,
    headers: { Accept: "application/json" },
  });
  expect(intoSub.status).toBe(201);
  expect(readFileSync(join(dir, "sub", "deep.txt"), "utf-8")).toBe("deep");

  // A plain HTML form post is redirected back to the listing it uploaded into.
  const formPost = new FormData();
  formPost.set("file", new File(["html"], "form.txt"));
  const redirected = await fetch(`${base}/`, {
    method: "POST",
    body: formPost,
    redirect: "manual",
  });
  expect(redirected.status).toBe(303);
  expect(redirected.headers.get("location")).toBe("/");

  const empty = await fetch(`${base}/`, { method: "POST", body: new FormData() });
  expect(empty.status).toBe(400);
});

test("PUT /path streams the body to a deduplicated name", async () => {
  const { base, dir } = await serveFixture();

  const res = await fetch(`${base}/uploaded-via-put.txt`, { method: "PUT", body: "streamed body" });
  expect(res.status).toBe(201);
  expect(await res.text()).toBe("Uploaded uploaded-via-put.txt\n");
  expect(readFileSync(join(dir, "uploaded-via-put.txt"), "utf-8")).toBe("streamed body");

  const nested = await fetch(`${base}/sub/put.txt`, { method: "PUT", body: "nested body" });
  expect(nested.status).toBe(201);
  expect(readFileSync(join(dir, "sub", "put.txt"), "utf-8")).toBe("nested body");

  const duplicate = await fetch(`${base}/uploaded-via-put.txt`, { method: "PUT", body: "again" });
  expect(await duplicate.text()).toBe("Uploaded uploaded-via-put (1).txt\n");

  expect((await fetch(`${base}/nowhere/put.txt`, { method: "PUT", body: "x" })).status).toBe(404);
});

test("traversal and malformed paths are refused", async () => {
  const { base } = await serveFixture();

  expect((await fetch(`${base}/%2e%2e%2fsecret`)).status).toBe(403);
  expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status).toBe(403);
  expect((await fetch(`${base}/%2e%2e%2fsecret`, { method: "PUT", body: "x" })).status).toBe(403);
  expect(
    (await fetch(`${base}/%2e%2e%2fsecret`, { method: "POST", body: new FormData() })).status,
  ).toBe(403);
  expect((await fetch(`${base}/%zz`)).status).toBe(400);
});
