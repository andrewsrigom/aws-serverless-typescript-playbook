import { build } from "esbuild";
import { readdir, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const selected = process.argv[2];

for (const scenario of await readdir("scenarios")) {
  if (selected && scenario !== selected) continue;

  for (const file of await readdir(`scenarios/${scenario}/src`)) {
    if (!file.endsWith("handler.ts")) continue;

    const name = file.replace(".ts", "");
    const out = `dist/${scenario}/${name}`;

    await mkdir(out, { recursive: true });
    await build({
      entryPoints: [`scenarios/${scenario}/src/${file}`],
      outfile: `${out}/index.cjs`,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      sourcemap: true,
    });
    execFileSync("zip", [
      "-q",
      "-j",
      `${process.cwd()}/${out}.zip`,
      `${out}/index.cjs`,
      `${out}/index.cjs.map`,
    ]);
  }
}
