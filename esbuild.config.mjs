import { build } from "esbuild";

const isProd = process.argv.includes("production");

build({
  entryPoints: ["main.ts"],
  bundle: true,
  minify: isProd,
  sourcemap: !isProd,
  outfile: "main.js",
  platform: "node",
  target: ["es2020"],
  external: ["obsidian"],
}).catch(() => process.exit(1));
