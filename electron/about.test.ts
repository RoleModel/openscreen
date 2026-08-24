import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type AboutFacts,
	COPYRIGHT,
	formatAboutDetail,
	PRODUCT_NAME,
	UPSTREAM_NAME,
	UPSTREAM_URL,
	usesNativeAboutPanel,
	WEBSITE_URL,
} from "./about";

function facts(overrides: Partial<AboutFacts> = {}): AboutFacts {
	return {
		version: "1.9.6",
		channel: "dmg",
		platform: "darwin",
		arch: "arm64",
		electron: "41.2.1",
		chrome: "138.0.7204.100",
		node: "22.22.1",
		...overrides,
	};
}

describe("formatAboutDetail", () => {
	it("lays the runtime, the install and the project out one per line", () => {
		expect(formatAboutDetail(facts())).toBe(
			[
				"Electron 41.2.1 · Chromium 138.0.7204.100 · Node 22.22.1",
				"darwin arm64 · dmg",
				WEBSITE_URL,
				`A RoleModel Software build of ${UPSTREAM_NAME} · ${UPSTREAM_URL}`,
			].join("\n"),
		);
	});

	// The macOS About panel prints the copyright in a field of its own, so a detail block that
	// carried it would show it twice there. Every other surface appends it itself.
	it("leaves the copyright line to the caller", () => {
		expect(formatAboutDetail(facts())).not.toContain(COPYRIGHT);
	});

	// The channel is the whole reason a Store or Flathub copy shows no update item, so it has
	// to be legible to whoever is reading the bug report rather than inferred from the platform.
	it("names the install channel, not just the platform", () => {
		expect(
			formatAboutDetail(facts({ platform: "win32", arch: "x64", channel: "store" })),
		).toContain("win32 x64 · store");
		expect(
			formatAboutDetail(facts({ platform: "linux", arch: "x64", channel: "appimage" })),
		).toContain("linux x64 · appimage");
	});
});

// The display name now lives in three files, because three different readers need it: this
// module for every surface Electron draws itself, CFBundleDisplayName for Finder, the Dock and
// the permission prompts, and CFBundleName for the menu bar. Nothing at runtime compares them,
// so drift would show up as an app called one thing in its menu bar and another in its About
// box — which is exactly what the name was changed to stop.
//
// `productName` is deliberately NOT in this set: it names the bundle on disk, which the cask's
// `app` stanza and the `openscreen` shim both depend on, and it stays upstream's.
describe("PRODUCT_NAME", () => {
	const config = () => readFileSync(new URL("../electron-builder.json5", import.meta.url), "utf8");
	const key = (name: string) => config().match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`))?.[1];

	it("matches the display name macOS reads out of Info.plist", () => {
		expect(key("CFBundleDisplayName")).toBe(PRODUCT_NAME);
	});

	/*
	 * CFBundleName must NOT be set, and this is the assertion that says why.
	 *
	 * Electron resolves its helper apps from CFBundleName, and electron-builder names
	 * them after `productName` — so they ship as "Openscreen Helper.app". Setting
	 * CFBundleName to "RoleModel Studio" sent Electron looking for "RoleModel Studio
	 * Helper.app", which does not exist, and the app aborted before drawing a window:
	 *
	 *   FATAL:electron_main_delegate_mac.mm:65] Unable to find helper app
	 *
	 * That is what made v0.0.1 unopenable. Nothing is lost by leaving it unset: the
	 * menu bar reads PRODUCT_NAME because main.ts calls app.setName at module scope,
	 * and everything a person actually reads comes from CFBundleDisplayName above.
	 */
	it("leaves CFBundleName unset, so Electron can still find its helper apps", () => {
		expect(key("CFBundleName")).toBeUndefined();
	});

	it("leaves the bundle on disk named upstream's, which the cask and the shim resolve", () => {
		expect(key("productName")).toBe("Openscreen");
	});

	// A permission dialog quotes its usage string verbatim, so one naming the old app is a
	// prompt about a program the person has never heard of.
	it("names this app in every permission prompt", () => {
		for (const k of [
			"NSAudioCaptureUsageDescription",
			"NSMicrophoneUsageDescription",
			"NSCameraUsageDescription",
			"NSScreenCaptureUsageDescription",
		]) {
			expect(key(k)).toContain(PRODUCT_NAME);
		}
	});
});

// Both about.ts and electron-builder.json5 state in prose that these two must stay
// byte-identical, and within one commit's lifetime they already came apart: the string moved
// here while the config key was still missing, which is precisely the second attribution on the
// binary — Get Info and the Windows file properties falling back to package.json's `author` —
// that declaring the key exists to prevent. A comment in two files cannot hold that; this can.
describe("COPYRIGHT", () => {
	it("matches the copyright electron-builder stamps into the bundle", () => {
		const config = readFileSync(new URL("../electron-builder.json5", import.meta.url), "utf8");
		const declared = config.match(/["']?copyright["']?\s*:\s*["']([^"']*)["']/)?.[1];
		expect(declared).toBe(COPYRIGHT);
	});
});

// CI is Linux-only, so the platform is pinned rather than read from `process` — the macOS
// branch is the one no automated run would otherwise ever execute.
describe("usesNativeAboutPanel", () => {
	it("sends macOS to its own panel", () => {
		expect(usesNativeAboutPanel("darwin")).toBe(true);
	});

	it("leaves every other platform on the message box we build", () => {
		expect(usesNativeAboutPanel("win32")).toBe(false);
		expect(usesNativeAboutPanel("linux")).toBe(false);
	});
});
