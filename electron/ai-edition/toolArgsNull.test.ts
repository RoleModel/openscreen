import { describe, expect, it } from "vitest";
import { addTrimArgs, getCursorTrackArgs, getTranscriptArgs } from "./agent-tools";

describe("optional tool args tolerate an explicit null", () => {
	it("getTranscript accepts assetId: null — the call from the report", () => {
		const r = getTranscriptArgs.safeParse({ assetId: null });
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.assetId).toBeUndefined();
	});
	it("and still accepts it omitted, and a real id", () => {
		expect(getTranscriptArgs.safeParse({}).success).toBe(true);
		const r = getTranscriptArgs.safeParse({ assetId: "asset_1" });
		expect(r.success && r.data.assetId).toBe("asset_1");
	});
	it("and still refuses an empty string, which is a real mistake", () => {
		expect(getTranscriptArgs.safeParse({ assetId: "" }).success).toBe(false);
	});
	it("getCursorTrack too", () => {
		expect(getCursorTrackArgs.safeParse({ assetId: null }).success).toBe(true);
	});
	it("and addTrim's optional ids", () => {
		const r = addTrimArgs.safeParse({ startSec: 1, endSec: 2, assetId: null, clipId: null });
		expect(r.success).toBe(true);
	});
});
