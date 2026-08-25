// Speech to text is a feature that can be absent from a build, and the two
// things that made that hard to live with were (a) nothing noticed until
// somebody pressed transcribe, and (b) what they were then told was a developer
// instruction. These cover both.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: vi.fn() } }));

afterEach(() => {
	vi.resetModules();
	vi.doUnmock("./gpuDetector");
});

describe("checkSttReadiness", () => {
	it("reports ready, with the backend and the path it found", async () => {
		vi.doMock("./gpuDetector", () => ({
			resolveBinaryPath: vi.fn(async () => ({
				backend: "whispercpp-metal",
				path: "/x/whisper-stt-server",
			})),
		}));
		const { checkSttReadiness } = await import("./index");
		await expect(checkSttReadiness()).resolves.toEqual({
			ready: true,
			backend: "whispercpp-metal",
			path: "/x/whisper-stt-server",
		});
	});

	// A missing helper is a missing feature, not a reason the app should fail to
	// start: everything that is not transcription or captions still works.
	it("reports not-ready without throwing when the binary is absent", async () => {
		vi.doMock("./gpuDetector", () => ({
			resolveBinaryPath: vi.fn(async () => ({ backend: "whispercpp-cpu", path: null })),
		}));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {
			// Swallowed: the point of the assertion below is that it was called.
		});
		const { checkSttReadiness } = await import("./index");
		await expect(checkSttReadiness()).resolves.toMatchObject({ ready: false, path: null });
		// One line, so the log says why before anyone presses transcribe.
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(/\[stt\] unavailable/);
		warn.mockRestore();
	});
});

describe("missingBinaryMessage", () => {
	it("tells a developer what to run", async () => {
		const { missingBinaryMessage } = await import("./whisperServer");
		expect(missingBinaryMessage(false)).toMatch(/npm run build:whisper-binaries/);
	});

	/*
	 * And tells an end user what happened instead.
	 *
	 * The packaged message must not name a script: the reader has no repo, and the
	 * build needs cmake and a C++ toolchain besides — so the old sentence asked
	 * them to do something impossible rather than saying what was wrong.
	 */
	it("tells an end user what happened, naming no script", async () => {
		const { missingBinaryMessage } = await import("./whisperServer");
		const message = missingBinaryMessage(true);
		expect(message).toMatch(/not available in this build/);
		expect(message).not.toMatch(/\.sh|npm run|cmake/);
		// And it says what is affected, so nobody reads it as "the app is broken".
		expect(message).toMatch(/Transcription and captions/);
	});
});
