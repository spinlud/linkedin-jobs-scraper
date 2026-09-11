/**
 * Unit tests for the CLI output writers, focused on table rendering and field resolution.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { IData } from "../scraper/events";
import { CliConfig } from "../cli/cli-config";
import { createWriter, resolveFields } from "../cli/output";
import { Spinner } from "../cli/spinner";

const WIDE_TERMINAL_COLUMNS = 300;

/** A spinner that is inert: pause() simply runs the callback without touching any stream. */
const createInertSpinner = (): Spinner => new Spinner({ write: () => undefined }, false);

const baseConfig = (overrides: Partial<CliConfig>): CliConfig => ({
    subcommand: "jobs",
    quiet: false,
    verbose: 0,
    noColor: true,
    noHeadless: false,
    baseDelay: 0,
    noAdaptive: false,
    pageLoadTimeout: 20,
    interactiveLogin: false,
    outFormat: "table",
    allFields: false,
    vertical: false,
    raw: false,
    query: "engineer",
    location: [],
    geoId: [],
    limit: 25,
    applyLink: false,
    skipPromotedJobs: false,
    pageOffset: 0,
    type: [],
    experience: [],
    onSiteOrRemote: [],
    industry: [],
    jobFunction: [],
    benefits: [],
    commitments: [],
    easyApply: false,
    under10Applicants: false,
    urlOrId: "",
    ...overrides,
});

const buildData = (overrides: Partial<IData>): IData => ({
    query: "engineer",
    location: "Remote",
    jobId: "1",
    jobIndex: 0,
    link: "https://example.com/job/1",
    title: "Engineer",
    company: "Acme",
    place: "Remote",
    date: "2026-01-01",
    dateText: "1 day ago",
    description: "",
    descriptionHTML: "",
    insights: [],
    isEasyApply: false,
    reposted: false,
    ...overrides,
});

/** Run the table writer over the given events, capturing every line written to stdout. */
const renderTable = (config: CliConfig, events: IData[]): string[] => {
    const captured: string[] = [];
    const writeSpy = jest
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array): boolean => {
            captured.push(typeof chunk === "string" ? chunk : chunk.toString());
            return true;
        });
    const columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", {
        value: WIDE_TERMINAL_COLUMNS,
        configurable: true,
    });
    try {
        const writer = createWriter(config, createInertSpinner());
        writer.begin();
        for (const event of events) {
            writer.write(event);
        }
        writer.end();
    } finally {
        writeSpy.mockRestore();
        if (columnsDescriptor) {
            Object.defineProperty(process.stdout, "columns", columnsDescriptor);
        } else {
            Reflect.deleteProperty(process.stdout, "columns");
        }
    }
    return captured.join("").split("\n");
};

describe("resolveFields", () => {
    it("omits isEasyApply from the default table columns", () => {
        const fields = resolveFields(baseConfig({}), "table");
        expect(fields).not.toContain("isEasyApply");
    });

    it("keeps isEasyApply selectable via --fields", () => {
        const config = baseConfig({ fields: ["title", "isEasyApply"] });
        expect(resolveFields(config, "table")).toEqual(["title", "isEasyApply"]);
    });

    it("keeps isEasyApply selectable via --all-fields", () => {
        const fields = resolveFields(baseConfig({ allFields: true }), "table");
        expect(fields).toContain("isEasyApply");
    });
});

describe("TableWriter", () => {
    it("renders an index header column with a matching leading rule segment", () => {
        const lines = renderTable(baseConfig({}), [buildData({})]);
        const header = lines[0];
        const rule = lines[1];
        expect(header.startsWith("index")).toBe(true);
        expect(rule.startsWith("─────")).toBe(true);
    });

    it("numbers rows from 1, right-justified", () => {
        const lines = renderTable(baseConfig({}), [
            buildData({ title: "First" }),
            buildData({ title: "Second" }),
        ]);
        const rows = lines.filter(line => line.includes("First") || line.includes("Second"));
        expect(rows[0].startsWith("    1")).toBe(true);
        expect(rows[1].startsWith("    2")).toBe(true);
    });

    it("resets the ordinal to 1 when a new query/location section starts", () => {
        const lines = renderTable(baseConfig({}), [
            buildData({ location: "Remote", title: "Alpha" }),
            buildData({ location: "Remote", title: "Beta" }),
            buildData({ location: "Berlin", title: "Gamma" }),
        ]);
        const rowGamma = lines.find(line => line.includes("Gamma")) ?? "";
        expect(rowGamma.startsWith("    1")).toBe(true);
    });

    it("renders isEasyApply when explicitly selected via --fields", () => {
        const config = baseConfig({ fields: ["title", "isEasyApply"] });
        const lines = renderTable(config, [buildData({ isEasyApply: true })]);
        expect(lines[0]).toContain("isEasyApply");
        const row = lines.find(line => line.includes("true")) ?? "";
        expect(row).toContain("true");
    });
});
