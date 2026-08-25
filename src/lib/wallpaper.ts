import { getAssetPath } from "@/lib/assetPath";
import { BRAND_WALLPAPERS } from "@/lib/brandWallpapers";

/*
 * The brand boards, and only those.
 *
 * The list used to be derived from a count and a naming convention — eighteen
 * `wallpaperN.jpg` — so a wallpaper not called that did not exist as far as the
 * picker was concerned, which is why the RoleModel set never appeared in it however
 * many times the branding was redone. Then it was both sets, ours first. It is now
 * ours alone: this is a branded build, and a picker offering eighteen stock
 * gradients alongside the boards invites a video that is off-brand by one click.
 *
 * They live under /wallpapers/brand/ with their own names rather than being
 * renumbered into the old run, which would lose the names and collide the moment
 * upstream adds one.
 *
 * projectPersistence keys its canonical set off this array, so a saved project that
 * still names a stock gradient now falls back to DEFAULT_WALLPAPER — index 0, which
 * is a brand board. That is the intended migration and the only visible effect on
 * existing projects.
 */
export const WALLPAPER_PATHS: readonly string[] = BRAND_WALLPAPERS.map((w) => w.path);

// Small (240x240, ~3-8KB) pre-generated copies used ONLY for the picker grid's swatches — the
// full-res originals (up to 4+MB, up to 7680px) are what `settings.wallpaper` still stores and
// what actually gets rendered/exported. Without this the grid was decoding all 18 originals
// (~20MB combined) simultaneously just to paint a few dozen px each (reported: picker felt slow
// to load).
export const WALLPAPER_THUMB_PATHS: readonly string[] = BRAND_WALLPAPERS.map((w) => w.thumb);

/**
 * A label for a bundled wallpaper, or null for anything not in the set.
 *
 * The picker shows a bare grid of swatches; ours have names worth reading and a
 * `title` is the cheapest place to put them.
 */
export function wallpaperLabel(path: string): string | null {
	return BRAND_WALLPAPERS.find((w) => w.path === path)?.label ?? null;
}

export const DEFAULT_WALLPAPER = WALLPAPER_PATHS[0];

export type WallpaperClassification =
	| { kind: "color"; value: string }
	| { kind: "gradient"; value: string }
	| { kind: "image"; path: string };

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\(/;
const COLOR_FUNC_RE = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/;
const IMAGE_URL_RE = /^(\/|https?:\/\/|file:\/\/|data:)/;

export function classifyWallpaper(value: string): WallpaperClassification {
	const trimmed = value.trim();
	if (trimmed === "") {
		return { kind: "color", value: "#000000" };
	}
	// Multi-background (e.g. "url(noise), linear-gradient(...)") - peel
	// the gradient layer off so the existing parser can still handle it.
	// Noise/url overlays are lost on export, but the live preview paints
	// the full string via CSS so the overlay shows up there.
	if (trimmed.startsWith("url(")) {
		const gradient = extractTrailingGradient(trimmed);
		if (gradient) return { kind: "gradient", value: gradient };
	}
	if (trimmed.startsWith("#") || COLOR_FUNC_RE.test(trimmed)) {
		return { kind: "color", value: trimmed };
	}
	if (GRADIENT_RE.test(trimmed)) {
		return { kind: "gradient", value: trimmed };
	}
	if (IMAGE_URL_RE.test(trimmed)) {
		return { kind: "image", path: trimmed };
	}
	return { kind: "color", value: trimmed };
}

function extractTrailingGradient(value: string): string | null {
	const match = value.match(/,\s*((?:repeating-)?(?:linear|radial|conic)-gradient\(.*\))\s*$/);
	return match?.[1] ?? null;
}

const ALLOWED_IMAGE_PREFIX = "/wallpapers/";

export class UnsafeImagePrefixError extends Error {
	constructor(prefix: string) {
		super(`Image wallpaper path must live under ${prefix}`);
		this.name = "UnsafeImagePrefixError";
	}
}

export function resolveImageWallpaperUrl(imagePath: string): string {
	if (
		imagePath.startsWith("http://") ||
		imagePath.startsWith("https://") ||
		imagePath.startsWith("file://") ||
		imagePath.startsWith("data:")
	) {
		return imagePath;
	}
	const withLeadingSlash = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
	if (!withLeadingSlash.startsWith(ALLOWED_IMAGE_PREFIX)) {
		throw new BackgroundLoadError(imagePath, new UnsafeImagePrefixError(ALLOWED_IMAGE_PREFIX));
	}
	try {
		return getAssetPath(withLeadingSlash.slice(1));
	} catch (cause) {
		if (cause instanceof BackgroundLoadError) throw cause;
		throw new BackgroundLoadError(imagePath, cause);
	}
}

export class BackgroundLoadError extends Error {
	readonly url: string;
	readonly cause?: unknown;

	constructor(url: string, cause?: unknown) {
		super(`Failed to load background image: ${displayBasename(url)}`);
		this.name = "BackgroundLoadError";
		this.url = url;
		this.cause = cause;
	}

	get displayUrl(): string {
		return displayBasename(this.url);
	}
}

function displayBasename(url: string): string {
	if (url.startsWith("data:")) {
		return "data:…";
	}
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).pop();
		return last ? decodeURIComponent(last) : "(unknown)";
	} catch {
		const last = url.split("/").filter(Boolean).pop();
		return last ?? "(unknown)";
	}
}
