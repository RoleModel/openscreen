/*
 * The editor, inside the Studio window.
 *
 * Opening a document used to create a second BrowserWindow. That is the same
 * process and the same Dock icon, but it does not read that way: you get another
 * titlebar, another entry in the Window menu, and the Studio's navigation
 * disappears behind it. The ask was for one window with the nav still there.
 *
 * The two pages cannot be one document. The Studio is served over http:// by a
 * separate process and the editor is the bundled renderer on file:// (or the Vite
 * dev server), so an iframe is blocked by the origin rules and a <webview> would
 * mean turning webviewTag on for a page a local web server controls. A
 * WebContentsView is the thing Electron provides for exactly this: a real web
 * contents, positioned in the host window's coordinate space, with its own
 * preload — so the editor keeps the full `electronAPI` surface while the Studio
 * page keeps its two calls.
 *
 * Which makes the layout the Studio's job and the position ours. The page
 * measures its own content area and hands us the rect; we put the view there and
 * move it when it changes. Nothing here guesses at where the nav ends.
 *
 * The view is created once and kept. Detaching on navigate-away and re-attaching
 * later means a trip to Scripts and back does not throw away an open timeline,
 * an undo stack, or a decode that took two seconds.
 */
import path from "node:path";
import { app, type BrowserWindow, WebContentsView } from "electron";
import { ASSET_BASE_URL_ARG } from "../windows";

/** Where the renderer is: the dev server if one is running, the bundle otherwise. */
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

/**
 * Resolved from `app.getAppPath()` rather than `__dirname`, which is what
 * windows.ts uses. Both are correct there, but this file may land in a different
 * chunk than the one that computes it, and the app path does not care.
 */
const rendererDist = () => path.join(app.getAppPath(), "dist");
const preloadPath = () => path.join(app.getAppPath(), "dist-electron", "preload.mjs");

/** A rectangle in the host window's content coordinates, as CSS pixels. */
export interface EditorRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

let view: WebContentsView | null = null;
let host: BrowserWindow | null = null;
let attached = false;

/** The editor's web contents, or null when it has never been created. */
export function embeddedEditorContents() {
	return view && !view.webContents.isDestroyed() ? view.webContents : null;
}

/** True when the view is currently in a window rather than parked. */
export function embeddedEditorAttached() {
	return attached;
}

/**
 * Bounds have to be whole pixels and cannot be negative.
 *
 * A rect measured mid-transition arrives with a fractional height, and a page
 * that is still laying out can report a zero or negative one. Electron takes both
 * without complaint and draws nothing, which looks like the editor failing to
 * load rather than like a layout that had not settled.
 */
const sane = (rect: EditorRect) => ({
	x: Math.round(rect.x),
	y: Math.round(rect.y),
	width: Math.max(1, Math.round(rect.width)),
	height: Math.max(1, Math.round(rect.height)),
});

function create(): WebContentsView {
	const created = new WebContentsView({
		webPreferences: {
			preload: preloadPath(),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			// Matches createEditorWindow. The editor reads media off disk by file://
			// URL, which is the whole reason that window turns this off.
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	// `embedded` is why the editor can drop its own wordmark: the shell around it
	// already shows the mark and the app name, and two of each stacked is what
	// makes an embedded view look like a mistake.
	const routing = { windowType: "editor", embedded: "1" };
	if (VITE_DEV_SERVER_URL) {
		created.webContents.loadURL(
			`${VITE_DEV_SERVER_URL}?${new URLSearchParams(routing).toString()}`,
		);
	} else {
		created.webContents.loadFile(path.join(rendererDist(), "index.html"), { query: routing });
	}

	// The same reason createEditorWindow does it: without a painted background the
	// area flashes white before React mounts, and here that flash is inside an
	// otherwise dark page rather than in a window of its own.
	created.webContents.on("dom-ready", () => {
		created.webContents.insertCSS(":root { --titlebar-inset-left: 0px; }").catch(() => {
			/* cosmetic, and the page may be mid-teardown */
		});
	});

	return created;
}

/**
 * Put the editor in the window at `rect`, creating it on first use.
 *
 * Safe to call repeatedly — the Studio calls it every time the Editor view is
 * rendered, and re-mounting an already-mounted view is just a bounds update.
 */
export function mountEmbeddedEditor(win: BrowserWindow, rect: EditorRect) {
	if (!view || view.webContents.isDestroyed()) {
		view = create();
		attached = false;
	}
	if (host !== win) {
		// Moving between windows would leave the view parented to a window that is
		// about to close. Detach from the old one first.
		if (host && !host.isDestroyed() && attached) host.contentView.removeChildView(view);
		host = win;
		attached = false;
	}
	if (!attached) {
		win.contentView.addChildView(view);
		attached = true;
	}
	view.setBounds(sane(rect));
	return true;
}

/** Move or resize it. A no-op when nothing is mounted, which the Studio may do on its way out. */
export function layoutEmbeddedEditor(rect: EditorRect) {
	if (!view || view.webContents.isDestroyed() || !attached) return false;
	view.setBounds(sane(rect));
	return true;
}

/**
 * Take it out of the window without throwing it away.
 *
 * Kept alive on purpose: navigating to Scripts and back should not cost an open
 * timeline and a re-decode. `destroyEmbeddedEditor` is the one that ends it.
 */
export function unmountEmbeddedEditor() {
	if (!view || !attached) return false;
	if (host && !host.isDestroyed()) host.contentView.removeChildView(view);
	attached = false;
	return true;
}

/** End it — called when the window that holds it is closing. */
export function destroyEmbeddedEditor() {
	if (!view) return;
	unmountEmbeddedEditor();
	if (!view.webContents.isDestroyed()) view.webContents.close();
	view = null;
	host = null;
}
