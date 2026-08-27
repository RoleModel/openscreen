#!/usr/bin/env node
/*
 * Launch the app from this checkout.
 *
 *   npm run app
 *
 * There is an incantation involved and nobody should have to remember it:
 *
 *   env -u ELECTRON_RUN_AS_NODE NODE_ENV=development \
 *     RM_STUDIO_BIN=../rolemodel-openscreen/bin/rm-studio.mjs npx electron .
 *
 * Each piece is load-bearing:
 *
 *   ELECTRON_RUN_AS_NODE   set by any Electron-hosted terminal, and inherited it
 *                          makes this run as plain node — the app dies on
 *                          "Cannot find module .../record" and the cause is
 *                          nowhere near the symptom.
 *   NODE_ENV               `production` makes npm omit dev dependencies, and it
 *                          is set in some shells here; development is what a
 *                          checkout wants.
 *   RM_STUDIO_BIN          the Studio is a separate process. Installed, it comes
 *                          from Homebrew; from a checkout it has to be pointed at.
 *
 * This also refuses to start rather than starting badly: an unbuilt renderer, a
 * missing Electron binary and an already-running instance each produce a
 * different message, because they need different fixes.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const die = (msg, fix) => {
	console.error(`\n  ${msg}\n`);
	if (fix) console.error(`  ${fix}\n`);
	process.exit(1);
};

// The renderer and the main process are built by vite, not by Electron. Without
// them the window opens on nothing at all, which looks like a hang.
if (
	!existsSync(join(ROOT, "dist-electron", "main.js")) ||
	!existsSync(join(ROOT, "dist", "index.html"))
) {
	die("this checkout has not been built yet", "npx vite build     # then try again");
}

const electron = join(
	ROOT,
	"node_modules",
	"electron",
	"dist",
	"Electron.app",
	"Contents",
	"MacOS",
	"Electron",
);
if (!existsSync(electron)) {
	die(
		"Electron is not installed in this checkout",
		"NODE_ENV=development npm ci\n\n  If that leaves it missing, npm 11 blocks install scripts by default:\n    npm install-scripts approve electron",
	);
}

/*
 * The Studio, which the app hosts in a window.
 *
 * Installed it is on PATH; from a checkout it is a sibling. Not fatal if absent —
 * the editor, recording and export all work without it, and saying which half is
 * missing beats refusing to start.
 */
const studioFromEnv = process.env.RM_STUDIO_BIN;
const sibling = resolve(ROOT, "..", "rolemodel-openscreen", "bin", "rm-studio.mjs");
const studio =
	studioFromEnv && existsSync(studioFromEnv) ? studioFromEnv : existsSync(sibling) ? sibling : null;

const env = { ...process.env, NODE_ENV: "development" };
// Stripped, not overridden: Electron checks for the variable's presence.
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
if (studio) env.RM_STUDIO_BIN = studio;

console.log("");
console.log(`  app     ${ROOT}`);
console.log(`  studio  ${studio ?? "not found — the Studio window will report why"}`);
console.log("");

const startedAt = Date.now();
const child = spawn(electron, [".", ...process.argv.slice(2)], {
	cwd: ROOT,
	env,
	stdio: "inherit",
});
child.on("exit", (code, signal) => {
	/*
	 * A second instance is not a crash, and it used to look exactly like one.
	 *
	 * main.ts takes a single-instance lock. A second copy hands its argv to the one
	 * already running and exits 0 immediately, so the whole visible result was the
	 * word "exited" a moment after you asked for it — reported as "the app keeps
	 * starting and then stopping", which is a fair reading of what it looked like.
	 *
	 * Under two seconds with a clean exit is that handoff, near enough. Anything
	 * slower was a real session, however short.
	 */
	const quick = Date.now() - startedAt < 2000;
	if (code === 0 && !signal && quick) {
		console.log("\n  another copy is already running — this one handed over to it and quit.");
		console.log("  That is the single-instance lock, not a crash.\n");
		console.log("  Look for the window it already has, or stop it first:");
		console.log("    pkill -f 'Electron \\.'\n");
	} else if (code === 0 && !signal) {
		console.log("\n  app exited\n");
	}
	process.exit(code ?? 1);
});
child.on("error", (err) => die(`could not start Electron: ${err.message}`));
