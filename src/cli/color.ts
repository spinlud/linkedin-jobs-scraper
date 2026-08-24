/**
 * Minimal zero-dependency ANSI colour helper and per-field colour table for CLI output.
 *
 * Colour is gated per stream: a caller decides once whether a given stream may carry escape
 * codes and passes that verdict to a Colorizer, which either wraps text or returns it untouched.
 */
import { DATA_FIELDS, isHyperlinkField } from "./data-fields";

export const ANSI_RESET = "\x1b[0m";
export const ANSI_BOLD = "\x1b[1m";
export const ANSI_DIM = "\x1b[2m";
export const ANSI_RED = "\x1b[31m";
export const ANSI_GREEN = "\x1b[32m";
export const ANSI_YELLOW = "\x1b[33m";
export const ANSI_BLUE = "\x1b[34m";
export const ANSI_MAGENTA = "\x1b[35m";
export const ANSI_CYAN = "\x1b[36m";
export const ANSI_ORANGE = "\x1b[38;5;208m";
export const ANSI_BRIGHT_GREEN = "\x1b[92m";
export const ANSI_BRIGHT_YELLOW = "\x1b[93m";
export const ANSI_BRIGHT_BLUE = "\x1b[94m";
export const ANSI_BRIGHT_MAGENTA = "\x1b[95m";
export const ANSI_BRIGHT_RED = "\x1b[91m";

// Hyperlink fields keep this cyan styling instead of a palette colour.
export const ANSI_LINK = ANSI_CYAN;

export const TABLE_ELLIPSIS = "…";

export interface WriteStream {
    isTTY?: boolean;
}

/**
 * Colour is allowed only when not disabled, NO_COLOR is unset, and the stream is a tty.
 * @param {boolean} noColor
 * @param {WriteStream} stream
 * @returns {boolean}
 */
export const colorEnabled = (noColor: boolean, stream: WriteStream): boolean => {
    if (noColor || process.env["NO_COLOR"]) {
        return false;
    }
    return Boolean(stream.isTTY);
};

/** Wraps text in ANSI codes when enabled, and is a no-op otherwise. */
export class Colorizer {
    constructor(private readonly _enabled: boolean) {}

    get enabled(): boolean {
        return this._enabled;
    }

    private _wrap(code: string, text: string): string {
        if (!this._enabled) {
            return text;
        }
        return `${code}${text}${ANSI_RESET}`;
    }

    red = (text: string): string => this._wrap(ANSI_RED, text);
    green = (text: string): string => this._wrap(ANSI_GREEN, text);
    yellow = (text: string): string => this._wrap(ANSI_YELLOW, text);
    magenta = (text: string): string => this._wrap(ANSI_MAGENTA, text);
    cyan = (text: string): string => this._wrap(ANSI_CYAN, text);
    orange = (text: string): string => this._wrap(ANSI_ORANGE, text);
    dim = (text: string): string => this._wrap(ANSI_DIM, text);
    bold = (text: string): string => this._wrap(ANSI_BOLD, text);
}

// Curated colours for the fields that carry the most meaning at a glance.
const SIGNATURE_FIELD_COLORS: Record<string, string> = {
    title: ANSI_BOLD,
    company: ANSI_GREEN,
    place: ANSI_YELLOW,
    date: ANSI_MAGENTA,
};

// Cycled across the remaining non-link fields so each gets a stable, distinct colour.
const FIELD_COLOR_PALETTE = [
    ANSI_BLUE,
    ANSI_RED,
    ANSI_BRIGHT_GREEN,
    ANSI_BRIGHT_YELLOW,
    ANSI_BRIGHT_BLUE,
    ANSI_BRIGHT_MAGENTA,
    ANSI_BRIGHT_RED,
];

/** Assign a stable colour to every non-link field; link fields keep cyan elsewhere. */
const buildFieldColors = (): Record<string, string> => {
    const colors: Record<string, string> = {};
    let paletteIndex = 0;

    for (const name of DATA_FIELDS) {
        if (isHyperlinkField(name)) {
            continue;
        }
        if (name in SIGNATURE_FIELD_COLORS) {
            colors[name] = SIGNATURE_FIELD_COLORS[name];
        } else {
            colors[name] = FIELD_COLOR_PALETTE[paletteIndex % FIELD_COLOR_PALETTE.length];
            paletteIndex += 1;
        }
    }

    return colors;
};

/**
 * Per-field ANSI colours applied to table values. The hyperlink fields keep their own cyan
 * styling instead of a colour from here.
 */
export const FIELD_COLORS = buildFieldColors();

/**
 * Wrap a label in an OSC 8 hyperlink pointing at url. Control characters that would corrupt the
 * escape envelope are stripped from the target. The escape bytes are zero-width, so this must be
 * applied after any width computation to keep column alignment intact.
 * @param {string} url
 * @param {string} label
 * @returns {string}
 */
export const hyperlink = (url: string, label: string): string => {
    const target = url.replace(/\x1b/g, "").replace(/\n/g, "").replace(/\r/g, "");
    return `\x1b]8;;${target}\x1b\\${label}\x1b]8;;\x1b\\`;
};

/**
 * Shorten a URL to a compact host/…/last-segment label, leaving non-URLs unchanged.
 * @param {string} url
 * @returns {string}
 */
export const compactUrl = (url: string): string => {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch (err) {
        return url;
    }

    if (!parsed.host) {
        return url;
    }

    const host = parsed.host.startsWith("www.") ? parsed.host.slice(4) : parsed.host;
    const segments = parsed.pathname.split("/").filter(segment => segment.length > 0);

    if (segments.length > 1) {
        return `${host}/${TABLE_ELLIPSIS}/${segments[segments.length - 1]}`;
    }
    if (segments.length === 1) {
        return `${host}/${segments[0]}`;
    }
    return host;
};
