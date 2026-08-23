/*
 * Run the RoleModel Studio inside this app.
 *
 * The Studio used to be a separate process you started yourself, in a browser
 * tab, talking to this app through the CLI. That split is where a long tail of
 * bugs came from: a PATH lookup, a probe asking the binary whether it supported
 * a verb, a shim to work around Electron's helper resolution through a symlink,
 * and a "launch the app and reveal the file in Finder" fallback for when the
 * probe said no. None of it was about making videos.
 *
 * So the app hosts it. The Studio is a plain HTTP server serving plain DOM — no
 * bundler, no framework — which means a BrowserWindow pointed at it is the whole
 * integration. Nothing is ported, nothing is shimmed, and this file is the only
 * new surface.
 *
 * The toolkit is NOT vendored into the bundle, on purpose. It is a Homebrew
 * formula with its own release cadence, and copying a second repository into an
 * Electron resource directory buys one artifact at the cost of two build systems
 * that have to agree. `rm-studio` on PATH is enough, and `RM_STUDIO_BIN` covers a
 * checkout.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { app } from "electron";

/** How long to wait for the server to answer before giving up on it. */
const READY_TIMEOUT_MS = 20_000;
const POLL_MS = 150;

export interface StudioHandle {
	url: string;
	stop: () => void;
}

let running: StudioHandle | null = null;
let child: ChildProcess | null = null;

/**
 * Find `rm-studio`.
 *
 * `RM_STUDIO_BIN` first, so a checkout can be pointed at without installing.
 * Then Homebrew's two prefixes, because a GUI app launched from Finder does not
 * inherit a shell's PATH and `/opt/homebrew/bin` is therefore not on it — the
 * single most common reason a spawn from an Electron main process fails while
 * the same command works in a terminal.
 */
export function findStudio(): string | null {
	const fromEnv = process.env.RM_STUDIO_BIN;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;

	const candidates = [
		"/opt/homebrew/bin/rm-studio", // Apple Silicon
		"/usr/local/bin/rm-studio", // Intel, and older installs
		...(process.env.PATH ?? "")
			.split(path.delimiter)
			.filter(Boolean)
			.map((dir) => path.join(dir, "rm-studio")),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** A port nobody is on. Asking the OS beats guessing and beats a fixed default. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => (port ? resolve(port) : reject(new Error("no port"))));
		});
	});
}

async function answers(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: "GET" });
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Start the Studio, or hand back the one already running.
 *
 * Idempotent because more than one thing wants to open the window — a menu item,
 * a dock click, the first launch — and each of them should get the same server
 * rather than starting another on another port.
 */
export async function startStudio(): Promise<StudioHandle> {
	if (running) return running;

	const bin = findStudio();
	if (!bin) {
		throw new Error(
			"rm-studio is not installed.\n\n  brew install rolemodel/tap/rm-video\n\nor set RM_STUDIO_BIN to a checkout's bin/rm-studio.mjs",
		);
	}

	const port = await freePort();
	const url = `http://127.0.0.1:${port}/`;

	// --no-open because we are the window: letting it open a browser tab as well
	// is how you end up with the Studio in two places disagreeing about state.
	//
	// ELECTRON_RUN_AS_NODE is stripped for the child's own good. We are an Electron
	// main process, so it is set in our environment; inherited, it makes any
	// Electron-based child run as plain node — which is what made `openscreen`
	// spawned from here die on "Cannot find module .../record".
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.ELECTRON_NO_ATTACH_CONSOLE;

	child = spawn(bin, ["--port", String(port), "--no-open"], {
		stdio: ["ignore", "pipe", "pipe"],
		env,
	});

	const log = (stream: "out" | "err") => (buf: Buffer) => {
		for (const line of buf.toString().split("\n")) {
			if (line.trim()) console.log(`[studio:${stream}] ${line}`);
		}
	};
	child.stdout?.on("data", log("out"));
	child.stderr?.on("data", log("err"));

	let exited: string | null = null;
	child.on("exit", (code, signal) => {
		exited = `rm-studio exited ${code ?? signal}`;
		child = null;
		running = null;
	});
	child.on("error", (err) => {
		exited = `rm-studio could not start: ${err.message}`;
	});

	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (exited) throw new Error(exited);
		if (await answers(url)) {
			running = {
				url,
				stop: () => {
					child?.kill();
					child = null;
					running = null;
				},
			};
			// A studio outliving the app would hold its port and its library lock.
			app.once("will-quit", () => running?.stop());
			return running;
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}

	child?.kill();
	child = null;
	throw new Error(`rm-studio did not answer on ${url} within ${READY_TIMEOUT_MS / 1000}s`);
}

/** The running Studio's URL, if there is one. */
export const studioUrl = (): string | null => running?.url ?? null;
