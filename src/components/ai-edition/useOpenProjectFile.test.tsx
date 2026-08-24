// @vitest-environment jsdom
//
// Regression cover for hand-overs from outside the editor.
//
// The bug this pins: the subscription used to live in EditorEmptyState, which
// unmounts the moment a document is open. The first hand-over worked and every
// one after it was dropped, so clicking a video in the Studio "succeeded" while
// the editor went on showing the previously opened document.
import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxcutDocument } from "@/lib/ai-edition/schema";
import { useIncomingProjectPath } from "./useOpenProjectFile";

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	loadProject: vi.fn(),
	loadProjectFileFromPath: vi.fn(),
	takePendingOpenPath: vi.fn(),
	onOpenProjectPath: vi.fn(),
}));

vi.mock("@/native", () => ({
	nativeBridgeClient: { aiEdition: { save: mocks.save } },
}));

vi.mock("@/lib/ai-edition/store/projectStore", () => ({
	useProjectStore: (select: (s: unknown) => unknown) => select({ loadProject: mocks.loadProject }),
}));

// A document is handed over by path; what comes back off disk is a current
// document, so the loader validates rather than migrates it.
function docWithId(id: string): AxcutDocument {
	return {
		schemaVersion: 7,
		project: {
			id,
			title: id,
			createdAt: "2026-06-25T10:00:00.000Z",
			updatedAt: "2026-06-25T10:00:00.000Z",
		},
		assets: [],
		transcript: null,
		transcripts: [],
		timeline: {
			clips: [],
			gaps: [],
			trimRanges: [],
			muteRanges: [],
			speedRanges: [],
			captionRanges: [],
		},
		annotations: [],
		zoomRanges: [],
		legacyEditor: null,
	} as AxcutDocument;
}

vi.mock("@/lib/ai-edition/schema", () => ({
	documentSchema: { parse: (d: unknown) => d },
}));
vi.mock("@/lib/ai-edition/document/migrate", () => ({
	migrateRawDocumentToCurrent: (d: unknown) => d,
	migrateProjectDataToAxcutDocument: (d: unknown) => d,
}));

function Host() {
	useIncomingProjectPath();
	return <div data-testid="host" />;
}

describe("useIncomingProjectPath", () => {
	let push: ((filePath: string) => void) | null = null;

	beforeEach(() => {
		for (const m of Object.values(mocks)) m.mockReset();
		push = null;
		mocks.takePendingOpenPath.mockResolvedValue(null);
		mocks.onOpenProjectPath.mockImplementation((cb: (p: string) => void) => {
			push = cb;
			return () => {
				push = null;
			};
		});
		mocks.loadProjectFileFromPath.mockImplementation(async (p: string) => ({
			success: true,
			project: docWithId(p.includes("feeney") ? "proj_feeney" : "proj_guides"),
		}));
		mocks.save.mockImplementation(async (doc: AxcutDocument) => ({ success: true, document: doc }));
		Object.assign(window, {
			electronAPI: {
				loadProjectFileFromPath: mocks.loadProjectFileFromPath,
				takePendingOpenPath: mocks.takePendingOpenPath,
				onOpenProjectPath: mocks.onOpenProjectPath,
			},
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("opens a second hand-over, not the one already open", async () => {
		render(<Host />);
		await waitFor(() => expect(mocks.onOpenProjectPath).toHaveBeenCalled());

		await act(async () => push?.("/tmp/feeney.openscreen"));
		await waitFor(() => expect(mocks.loadProject).toHaveBeenCalledWith("proj_feeney"));

		// The editor now has a document open. In the old arrangement the empty
		// state had unmounted by this point and this push reached nobody.
		await act(async () => push?.("/tmp/ai-guides.openscreen"));
		await waitFor(() => expect(mocks.loadProject).toHaveBeenCalledWith("proj_guides"));

		expect(mocks.loadProject).toHaveBeenCalledTimes(2);
		expect(mocks.loadProject).toHaveBeenLastCalledWith("proj_guides");
	});

	it("opens a document parked before the listener existed", async () => {
		mocks.takePendingOpenPath.mockResolvedValue("/tmp/feeney.openscreen");
		render(<Host />);
		await waitFor(() => expect(mocks.loadProject).toHaveBeenCalledWith("proj_feeney"));
	});
});
