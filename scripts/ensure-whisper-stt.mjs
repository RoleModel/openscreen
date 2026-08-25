#!/usr/bin/env node
/*
 * Make sure the speech-to-text helper is present before an installer is built.
 *
 * WHY THIS EXISTS. `electron/native/bin/` is gitignored, and the two things that
 * can put `whisper-stt-server` in it were wired into nothing:
 *
 *   scripts/build-whisper-stt.sh   compiles whisper.cpp here, from source
 *   scripts/stage-whisper-stt.sh   downloads what build-whisper-stt.yml built in CI
 *
 * `build:whisper-binaries` existed as an npm script and no build called it, and
 * the staging script was not an npm script at all. So `build:mac` — which builds
 * the ScreenCaptureKit helper, fetches ffmpeg and builds the compositor addon —
 * produced an app with no STT binary in it, and the failure surfaced much later
 * as a toast telling an end user to run a shell script from a repo they do not
 * have. The staging script's own header describes this; nothing had connected it.
 *
 * Deliberately NOT run at app launch. Compiling whisper.cpp needs cmake, a C++
 * toolchain and three git clones, and the Metal build is minutes of CPU: work
 * nobody would choose to wait through while an app opens, and work that fails
 * outright on a machine without the toolchain. Launch's job is to notice the
 * binary is missing and say so — see checkSttReadiness() in electron/stt/index.ts.
 *
 * Order of preference:
 *   1. Already staged            — nothing to do, and the common case.
 *   2. A CI artifact            — same provenance as a release, so prefer it.
 *   3. Compile it here          — needs cmake; the fallback for a local build.
 *
 * Exits non-zero when it cannot produce one. A release without speech to text is
 * worse than a red build, and the failure this replaces was silent.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The same `<os>-<arch>` tag gpuDetector.ts builds its candidate paths from. */
function hostTag() {
	const a = arch() === "arm64" ? "arm64" : "x64";
	if (platform() === "darwin") return `darwin-${a}`;
	if (platform() === "win32") return "win32-x64";
	return "linux-x64";
}

const TAG = hostTag();
const BIN_DIR = path.join(ROOT, "electron", "native", "bin", TAG);
const EXE = platform() === "win32" ? "whisper-stt-server.exe" : "whisper-stt-server";

const has = () => existsSync(path.join(BIN_DIR, EXE));
const tool = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;

function run(cmd, args, label) {
	console.log(`  ${label}…`);
	// Inherited stdio on purpose: a cmake build is minutes long, and a silent
	// pipe makes it look hung. Whoever started this wants to see it working.
	const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
	return r.status === 0;
}

if (has()) {
	console.log(`  speech to text: already staged (${path.join("electron/native/bin", TAG, EXE)})`);
	process.exit(0);
}

console.log(`  speech to text: no ${EXE} for ${TAG} — getting one`);

/*
 * A CI artifact first, when the tools for it are here.
 *
 * Same provenance as a release: build-whisper-stt.yml pins its build hosts, and
 * on Linux the glibc the binaries were linked against has to match the floor
 * before-pack.cjs enforces. A local compile on a newer distro produces something
 * that build then rejects. `gh` and a token are what staging needs; without them
 * this is not an error, it is just not the available route.
 */
if (tool("gh") && (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) {
	if (
		run("bash", [path.join("scripts", "stage-whisper-stt.sh"), TAG], "staging the CI build") &&
		has()
	) {
		console.log("  speech to text: staged from CI");
		process.exit(0);
	}
	console.log("  staging did not produce a binary — falling back to a local build");
} else {
	console.log("  no gh + GH_TOKEN, so no CI artifact to stage — building locally");
}

/*
 * Otherwise compile it, and say exactly what is missing when we cannot.
 *
 * "cmake: command not found" out of a nested build is a long way from the thing
 * to do about it, and this is the point where somebody is waiting.
 */
if (!tool("cmake")) {
	console.error(`
  Cannot build the speech-to-text helper: cmake is not installed.

  Either install it and re-run:      brew install cmake        (macOS)
  or stage the build CI already did: export GH_TOKEN=…  &&  npm run whisper:ensure

  Shipping without it means transcription and captions do not work in the
  installer, and the app can only tell the person using it that they are missing.
`);
	process.exit(1);
}

if (
	!run(
		"bash",
		[path.join("scripts", "build-whisper-stt.sh")],
		"compiling whisper.cpp (several minutes)",
	)
) {
	console.error("\n  The speech-to-text build failed. See the output above.\n");
	process.exit(1);
}

if (!has()) {
	// The build reported success and produced nothing where the app looks. Worth
	// distinguishing: it means the staging half of build-whisper-stt.sh changed,
	// not that the compile is broken.
	console.error(`
  The build succeeded but ${EXE} is not in ${path.relative(ROOT, BIN_DIR)}.

  Present there: ${existsSync(BIN_DIR) ? readdirSync(BIN_DIR).join(", ") || "(empty)" : "(no such directory)"}

  gpuDetector.ts looks for it under electron/native/bin/<os>-<arch>/, so a build
  that stages it elsewhere is a build the app cannot find.
`);
	process.exit(1);
}

console.log("  speech to text: built");
