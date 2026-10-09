import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["bin/lgnh-cli.ts"],
  target: "bun",
  minify: true,
  plugins: [solidPlugin],
  // The launcher only loads the Solid runtime transform in source mode; keep it (and Babel) out of
  // the executable, where JSX is already transformed here.
  external: ["@opentui/solid/bun-plugin"],
  // Standalone runs must not depend on whatever bunfig.toml sits in the invocation directory.
  compile: { outfile: "dist/lgnh", autoloadBunfig: false },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log("Built dist/lgnh");
