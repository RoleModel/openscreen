/*
 * The bridge the Studio page gets. Two calls, and no more.
 *
 * The app-wide preload exposes the whole `electronAPI` surface — recording,
 * transcription, the filesystem. The Studio is served over HTTP by a separate
 * process, and handing that page the same surface would mean any page that
 * process ever serves has the run of the machine. So it gets what it needs:
 * open a document in the editor, and ask which project directory the app is
 * looking at.
 *
 * `openProject` is what replaces the old round trip. Opening a document used to
 * mean the Studio shelling out to `openscreen open <file>`, which needed a PATH
 * lookup, a probe for whether the installed build supported the verb, and a
 * launch-and-reveal fallback for when it did not. In here it is a function call.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rmStudio", {
	/** True when the Studio is running inside the app rather than in a browser. */
	hosted: true,

	/** Open a .openscreen document in the editor. Resolves once the window has it. */
	openProject: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
		ipcRenderer.invoke("studio:open-project", filePath),

	/** Bring the editor forward without changing what it has open. */
	showEditor: (): Promise<void> => ipcRenderer.invoke("studio:show-editor"),
});
