import {
    DEFAULT_BASE_DELAY,
    MIN_SLOW_MO,
    PACING_CEILING_FACTOR,
    PACING_CEILING_LIMIT,
    PACING_INCREASE_FACTOR,
    PACING_EASE_FACTOR,
    CLEAN_RUN_BEFORE_EASING,
} from "./constants";

export interface IPacingOptions {
    baseDelay?: number; // Seconds slept between jobs, the floor the pacer never eases below
    adaptive?: boolean; // Let the run find its own pace between baseDelay and its ceiling
}

/**
 * @class Pacer
 * The delay every sleep site of a run reads, moved by what LinkedIn answers. `baseDelay` is the
 * floor and never a fixed value: a pace comfortable for 25 jobs is not comfortable for 200, so
 * the number to sleep is discovered while the run runs. One instance serves a whole run, shared
 * by every sequential location, since LinkedIn enforces its limit per account.
 *
 * A pacer whose ceiling equals its floor is inert - `min(delay * factor, ceiling)` cannot move -
 * which is what an opted out caller gets.
 */
export class Pacer {
    private readonly _floor: number;
    private readonly _ceiling: number;
    private _delay: number;
    private _cleanStreak: number = 0;
    private _throttledCount: number = 0;

    constructor(floor: number, ceiling: number) {
        if (ceiling < floor) {
            throw new Error("A pacer cannot have a ceiling below its floor");
        }

        this._floor = floor;
        this._ceiling = ceiling;
        this._delay = floor;
    }

    /**
     * How long to sleep, in seconds, now
     * @returns {number}
     */
    get delay(): number {
        return this._delay;
    }

    /**
     * How many refusals have been reported to this pacer
     * @returns {number}
     */
    get throttledCount(): number {
        return this._throttledCount;
    }

    /**
     * Report a 429 and slow the run down. Counting happens whether or not the pace can move, so
     * the number stays meaningful for a run that opted out of adapting.
     * @returns {number} the new delay
     */
    throttled(): number {
        this._throttledCount += 1;
        this._cleanStreak = 0;
        this._delay = Math.min(this._delay * PACING_INCREASE_FACTOR, this._ceiling);

        return this._delay;
    }

    /**
     * Report one unit of work nobody refused, easing the pace once enough have gone through
     * @returns {number} the new delay
     */
    clean(): number {
        this._cleanStreak += 1;

        if (this._cleanStreak < CLEAN_RUN_BEFORE_EASING) {
            return this._delay;
        }

        this._cleanStreak = 0;
        this._delay = Math.max(this._delay / PACING_EASE_FACTOR, this._floor);

        return this._delay;
    }
}

/**
 * Build the pacer for a run from its pacing options
 * @param {IPacingOptions} [pacing]
 * @returns {Pacer}
 */
export const createPacer = (pacing?: IPacingOptions): Pacer => {
    const baseDelay = pacing?.baseDelay ?? DEFAULT_BASE_DELAY;
    const adaptive = pacing?.adaptive ?? true;

    if (typeof baseDelay !== "number" || baseDelay < MIN_SLOW_MO) {
        throw new Error(
            `pacing.baseDelay must be a number of seconds no smaller than ${MIN_SLOW_MO}: ` +
            `LinkedIn answers a run that asks for pages faster than that with 429 (too many requests)`
        );
    }

    // The floor is the base delay itself; the ceiling opens up only when adapting, otherwise it
    // equals the floor and the pace can never move.
    const floor = baseDelay;
    const ceiling = adaptive
        ? Math.min(PACING_CEILING_LIMIT, baseDelay * PACING_CEILING_FACTOR)
        : baseDelay;

    return new Pacer(floor, ceiling);
};
