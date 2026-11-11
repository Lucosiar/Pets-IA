/**
 * Builds the release for the OS it runs on into dist/:
 *   macOS   → dist/petsia-macos-arm64.tar.gz and dist/petsia-macos-x64.tar.gz
 *             (petsia, petsia-overlay, PetsIA_PetsCore.bundle)
 *   Windows → dist/petsia-windows-x64.zip (petsia.exe, petsia-overlay.exe)
 *
 *   bun scripts/build.ts [--version 1.2.3] [--arch arm64|x64]...
 */
import { $ } from "bun";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const ROOT = dirname(import.meta.dir);
const DIST = join(ROOT, "dist");
const { values } = parseArgs({ options: { version: { type: "string" }, arch: { type: "string", multiple: true } } });
const version = values.version ?? "0.0.0-dev";
const define = `PETSIA_VERSION=${JSON.stringify(version)}`;
const entry = join(ROOT, "agent", "src", "petsia.ts");

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

if (process.platform === "darwin") {
  const ARCHS = { arm64: "arm64", x64: "x86_64" } as const;
  const archs = (values.arch ?? Object.keys(ARCHS)) as (keyof typeof ARCHS)[];
  for (const arch of archs) {
    const out = join(DIST, `petsia-macos-${arch}`);
    await mkdir(out, { recursive: true });
    await $`bun build ${entry} --compile --minify --target=${`bun-darwin-${arch}`} --define ${define} --outfile ${join(out, "petsia")}`;
    const swiftArch = ARCHS[arch];
    await $`swift build -c release --arch ${swiftArch} --product petsia-overlay`.cwd(ROOT);
    const bin = (await $`swift build -c release --arch ${swiftArch} --show-bin-path`.cwd(ROOT).text()).trim();
    await cp(join(bin, "petsia-overlay"), join(out, "petsia-overlay"));
    await cp(join(bin, "PetsIA_PetsCore.bundle"), join(out, "PetsIA_PetsCore.bundle"), { recursive: true });
    // Ad-hoc signatures: enough for binaries downloaded with curl, which macOS doesn't quarantine.
    await $`codesign --force --sign - ${join(out, "petsia")} ${join(out, "petsia-overlay")}`;
    await cp(join(ROOT, "LICENSE"), join(out, "LICENSE"));
    await $`tar -czf ${`${out}.tar.gz`} -C ${out} .`;
  }
} else if (process.platform === "win32") {
  const out = join(DIST, "petsia-windows-x64");
  await mkdir(out, { recursive: true });
  await $`bun build ${entry} --compile --minify --target=bun-windows-x64 --define ${define} --outfile ${join(out, "petsia.exe")}`;
  const numeric = version.replace(/[^0-9.].*$/, "") || "0.0.0";
  await $`dotnet publish ${join(ROOT, "windows", "PetsIA", "PetsIA.csproj")} -c Release -o ${join(out, "overlay")} -p:Version=${numeric}`;
  await cp(join(out, "overlay", "petsia-overlay.exe"), join(out, "petsia-overlay.exe"));
  await rm(join(out, "overlay"), { recursive: true, force: true });
  await cp(join(ROOT, "LICENSE"), join(out, "LICENSE"));
  await $`powershell -NoProfile -Command ${`Compress-Archive -Path '${out}\\*' -DestinationPath '${out}.zip' -Force`}`;
} else {
  throw new Error("build on macOS or Windows");
}

console.log(`Built ${version} in ${DIST}`);
