import { describe, it, expect } from "@jest/globals";
import { Feedback } from "../cli/feedback";
import { IMetrics } from "../scraper/events";
import { Colorizer } from "../cli/color";
import { Spinner } from "../cli/spinner";

const makeMetrics = (overrides: Partial<IMetrics> = {}): IMetrics => ({
    processed: 0,
    failed: 0,
    missed: 0,
    skipped: 0,
    throttled: 0,
    pace: 0,
    ...overrides,
});

interface Harness {
    feedback: Feedback;
    lines: () => string[];
}

// Build a Feedback wired to an inert spinner and a colour-less colorizer, capturing every
// diagnostics line without ANSI codes for exact assertions.
const makeHarness = (quiet: boolean): Harness => {
    const chunks: string[] = [];
    const spinner = new Spinner({ write: () => {} }, false);
    const feedback = new Feedback(
        quiet,
        (text: string) => chunks.push(text),
        new Colorizer(false),
        spinner,
    );
    return {
        feedback,
        lines: () =>
            chunks
                .join("")
                .split("\n")
                .filter(line => line.length > 0),
    };
};

describe("[FEEDBACK]", () => {
    it("prints an unchanged single-location done line", () => {
        const { feedback, lines } = makeHarness(false);
        feedback.setLocationLabels(["Berlin"]);

        feedback.onBegin({ jobTotal: 10 });
        feedback.onMetrics(
            makeMetrics({ processed: 3, failed: 1, missed: 2, skipped: 4, throttled: 5, pace: 7 }),
        );
        feedback.onEnd();

        expect(lines()).toContain(
            "done: processed=3 failed=1 missed=2 skipped=4 throttled=5 pace=7s",
        );
    });

    it("renders per-location rows and a summed total for multi-location runs", () => {
        const { feedback, lines } = makeHarness(false);
        feedback.setLocationLabels(["Berlin", "Munich"]);

        feedback.onBegin({ jobTotal: 10 });
        feedback.onMetrics(
            makeMetrics({ processed: 3, failed: 1, missed: 2, skipped: 0, throttled: 4, pace: 6 }),
        );

        feedback.onBegin({ jobTotal: 8 });
        feedback.onMetrics(
            makeMetrics({ processed: 5, failed: 2, missed: 1, skipped: 3, throttled: 9, pace: 11 }),
        );

        feedback.onEnd();

        const output = lines();
        expect(output).toContain("done:");

        const berlinRow = output.find(
            line => line.includes("Berlin") && line.includes("processed="),
        );
        const munichRow = output.find(
            line => line.includes("Munich") && line.includes("processed="),
        );
        const totalRow = output.find(line => line.trimStart().startsWith("total"));

        // Per-location rows omit throttled/pace.
        expect(berlinRow).toContain("processed=3 failed=1 missed=2 skipped=0");
        expect(berlinRow).not.toContain("throttled");
        expect(munichRow).toContain("processed=5 failed=2 missed=1 skipped=3");
        expect(munichRow).not.toContain("throttled");

        // Counts are summed; throttled/pace carry the last location's account-wide values.
        expect(totalRow).toContain(
            "processed=8 failed=3 missed=3 skipped=3 throttled=9 pace=11s",
        );
    });

    it("keeps bookkeeping under --quiet without printing a summary", () => {
        const { feedback, lines } = makeHarness(true);
        feedback.setLocationLabels(["Berlin", "Munich"]);

        feedback.onBegin({ jobTotal: 10 });
        feedback.onMetrics(makeMetrics({ processed: 3 }));
        feedback.onBegin({ jobTotal: 8 });
        feedback.onMetrics(makeMetrics({ processed: 5 }));

        expect(() => feedback.onEnd()).not.toThrow();
        expect(lines()).toEqual([]);
    });

    it("snapshots per-location metrics so a shared mutated reference does not leak across locations", () => {
        const { feedback, lines } = makeHarness(false);
        feedback.setLocationLabels(["Berlin", "Munich"]);

        // Emulate the scraper reusing and mutating one metrics object across locations.
        const shared = makeMetrics({ processed: 3, failed: 1 });
        feedback.onBegin({ jobTotal: 10 });
        feedback.onMetrics(shared);

        shared.processed = 5;
        shared.failed = 2;
        feedback.onBegin({ jobTotal: 8 });
        feedback.onMetrics(shared);

        feedback.onEnd();

        const output = lines();
        const berlinRow = output.find(
            line => line.includes("Berlin") && line.includes("processed="),
        );
        expect(berlinRow).toContain("processed=3 failed=1");
    });
});
