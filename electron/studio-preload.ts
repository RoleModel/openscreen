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

	/** Bring the separate editor window forward without changing what it has open. */
	showEditor: (): Promise<void> => ipcRenderer.invoke("studio:show-editor"),

	/*
	 * The editor as a view inside this window, rather than a window of its own.
	 *
	 * The page passes the rect of its own content area, because it is the only side
	 * that knows where its navigation ends — the host would otherwise have to carry
	 * a copy of the Studio's layout and keep it in step with the stylesheet.
	 * Coordinates are CSS pixels relative to the window's content area, which is
	 * what `getBoundingClientRect()` already returns.
	 */
	mountEditor: (rect: EditorRect): Promise<Mounted> =>
		ipcRenderer.invoke("studio:mount-editor", rect),
	layoutEditor: (rect: EditorRect): Promise<Mounted> =>
		ipcRenderer.invoke("studio:layout-editor", rect),
	unmountEditor: (): Promise<Mounted> => ipcRenderer.invoke("studio:unmount-editor"),

	/*
	 * The host asking for the Editor view. Main to page, one way.
	 *
	 * The recording HUD's "switch to editor" has to land in this window rather than
	 * open another one, and the host cannot do that on its own: showing the editor
	 * means changing this page's navigation, which only this page defines. So it is
	 * told to, and it decides what that means.
	 *
	 * Returns its own unsubscribe, like every other listener the app exposes.
	 */
	onShowEditor: (callback: () => void): (() => void) => {
		const listener = () => callback();
		ipcRenderer.on("studio:show-editor-view", listener);
		return () => ipcRenderer.removeListener("studio:show-editor-view", listener);
	},
});

interface EditorRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Mounted {
	ok: boolean;
	error?: string;
}
