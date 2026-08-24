// Opening a project document that arrives from outside the editor.
//
// This lives outside EditorEmptyState because the empty state is exactly the
// component that goes away once a document is open: it renders in the `else`
// branch of Preview's "is there media" test, so mounting the arrival routes
// inside it meant they were subscribed only while the editor was empty. The
// first hand-over worked; every one after it landed on an unmounted listener
// and the editor went on showing the previous document. Symptom from the
// Studio side was the worst kind — clicking a video "worked" and opened
// somebody else's deck.
//
// So: the loader is a hook the empty state uses for its own drop/picker, and
// the subscription is a separate hook mounted by the shell, which stays up for
// the life of the window.

import { useCallback, useEffect } from "react";
import {
	migrateProjectDataToAxcutDocument,
	migrateRawDocumentToCurrent,
} from "@/lib/ai-edition/document/migrate";
import { documentSchema } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { nativeBridgeClient } from "@/native";

/**
 * Save a loaded project document and make it the open one.
 *
 * A loaded project JSON is either a current AxcutDocument (has its own
 * `schemaVersion`) or a legacy EditorProjectData that must be migrated.
 * Discriminate on the version field so a current document is never fed to the
 * legacy migrator (which reads `.media`/`.editor` and would yield an empty
 * doc). Returns true once the project is saved and loaded.
 */
export function useOpenLoadedProject() {
	const loadProject = useProjectStore((s) => s.loadProject);
	return useCallback(
		async (raw: unknown): Promise<boolean> => {
			const isAxcutDocument =
				typeof raw === "object" && raw !== null && "schemaVersion" in raw && "timeline" in raw;
			const doc = isAxcutDocument
				? documentSchema.parse(migrateRawDocumentToCurrent(raw)) // disk-load: upgrade v3/v4 → v5, then validate
				: migrateProjectDataToAxcutDocument(raw as never);
			const saved = await nativeBridgeClient.aiEdition.save(doc);
			if (!saved.success || !saved.document) return false;
			await loadProject(doc.project.id);
			return true;
		},
		[loadProject],
	);
}

/**
 * Read a document off disk and open it. Same two steps the drop handler takes,
 * because it is the same job: read the file, then open what came back.
 */
export function useOpenProjectFromPath(onError?: () => void) {
	const openLoadedProject = useOpenLoadedProject();
	return useCallback(
		async (filePath: string) => {
			try {
				const result = await window.electronAPI?.loadProjectFileFromPath?.(filePath);
				if (!result?.success || !result.project) {
					onError?.();
					return;
				}
				if (!(await openLoadedProject(result.project))) onError?.();
			} catch {
				onError?.();
			}
		},
		[openLoadedProject, onError],
	);
}

/**
 * Subscribe to documents handed in from outside — `openscreen open <file>`, a
 * file association, a second launch with a path, or the Studio handing over the
 * video the user just clicked.
 *
 * Two arrival routes, because a document can be handed over before or after
 * this hook exists. Asking is the one that matters at launch: the main process
 * parks the path rather than pushing it, since `did-finish-load` fires before
 * React mounts and a pushed message would land on nobody. Listening covers
 * every hand-over after that, which is why this must be mounted by something
 * that outlives the empty state.
 */
export function useIncomingProjectPath(onError?: () => void) {
	const openFromPath = useOpenProjectFromPath(onError);
	useEffect(() => {
		const api = window.electronAPI;
		if (!api) return;
		void api.takePendingOpenPath?.().then((filePath) => {
			if (filePath) void openFromPath(filePath);
		});
		return api.onOpenProjectPath?.((filePath: string) => void openFromPath(filePath));
	}, [openFromPath]);
}
