/**
 * Animated terminal spinner that coordinates the two CLI output streams.
 *
 * The CLI writes diagnostics to stderr and job data to stdout, both usually the same physical
 * terminal. A single animated line lives on stderr; any code that prints to the terminal during
 * the run does so through `pause()` so the animated line is cleared first and never interleaves
 * with the printed text. A disabled spinner is inert: every method is a no-op and `pause()`
 * simply runs the callback without touching the stream.
 */
import { CliConfig } from "./cli-config";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 100;
const SEARCH_EMOJI = "🔎";

// Carriage return then ANSI erase-to-end-of-line. Clears by terminal column rather than by
// character count, so a leading wide glyph like the emoji leaves no residue.
const CLEAR_LINE = "\r\x1b[K";

export interface DiagnosticsStream {
    write(text: string): void;
    isTTY?: boolean;
}

export class Spinner {
    private readonly _stream: DiagnosticsStream;
    private readonly _enabled: boolean;
    private _frameIndex = 0;
    private _label = "";
    private _timer: NodeJS.Timeout | null = null;

    constructor(stream: DiagnosticsStream, enabled: boolean) {
        this._stream = stream;
        this._enabled = enabled;
    }

    private _compose(frame: string): string {
        return `${SEARCH_EMOJI} ${frame} ${this._label}`;
    }

    private _draw(): void {
        const frame = FRAMES[this._frameIndex % FRAMES.length];
        this._frameIndex += 1;
        this._stream.write(CLEAR_LINE + this._compose(frame));
    }

    private _clear(): void {
        this._stream.write(CLEAR_LINE);
    }

    /** Set the initial label and start the animation, lazily and once. */
    start(label: string): void {
        if (!this._enabled) {
            return;
        }
        this._label = label;
        if (this._timer === null) {
            this._timer = setInterval(() => this._draw(), INTERVAL_MS);
            // Do not keep the event loop alive purely for the animation.
            if (typeof this._timer.unref === "function") {
                this._timer.unref();
            }
        }
    }

    /** Change the label shown on the next tick. */
    setLabel(label: string): void {
        if (!this._enabled) {
            return;
        }
        this._label = label;
    }

    /** Stop the animation and clear the line. Idempotent. */
    stop(): void {
        if (!this._enabled) {
            return;
        }
        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._clear();
    }

    /**
     * Clear the animated line, run the callback so it prints cleanly, then let the animation
     * resume on the next tick. When disabled this simply runs the callback.
     * @param {() => void} callback
     * @returns {void}
     */
    pause(callback: () => void): void {
        if (!this._enabled) {
            callback();
            return;
        }
        this._clear();
        callback();
    }
}

/** Build the stderr spinner, animated only on an interactive, non-quiet run. */
export const createSpinner = (config: CliConfig): Spinner => {
    const stream: DiagnosticsStream = {
        write: (text: string) => {
            process.stderr.write(text);
        },
        isTTY: process.stderr.isTTY,
    };
    return new Spinner(stream, Boolean(process.stderr.isTTY) && !config.quiet);
};
