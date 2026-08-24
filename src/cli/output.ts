/**
 * Output writers for scraped job data.
 *
 * The CLI drives a writer through a small lifecycle: begin() opens the destination, write(data)
 * is called once per DATA event as it streams in, and end() closes the destination. One writer
 * exists per output format behind a common interface, and createWriter() resolves the format and
 * field selection from the parsed CliConfig.
 */
import * as fs from "fs";
import * as path from "path";
import { IData } from "../scraper/events";
import { CliConfig } from "./cli-config";
import { DATA_FIELDS, isHyperlinkField } from "./data-fields";
import {
    ANSI_BOLD,
    ANSI_LINK,
    ANSI_RESET,
    FIELD_COLORS,
    TABLE_ELLIPSIS,
    compactUrl,
    hyperlink,
} from "./color";
import { Spinner } from "./spinner";

const EXTENSION_FORMATS: Record<string, string> = {
    ".csv": "csv",
    ".json": "json",
    ".jsonl": "jsonl",
};
const DEFAULT_STRUCTURED_FORMAT = "jsonl";

const TABLE_DEFAULT_FIELDS = [
    "title",
    "company",
    "place",
    "date",
    "salary",
    "isEasyApply",
    "applicantCount",
    "benefits",
    "reposted",
    "link",
];
const TABLE_LIST_SEPARATOR = ", ";
const STRUCTURED_LIST_SEPARATOR = "|";

const TABLE_COLUMN_SEPARATOR = "  ";
const TABLE_MIN_COLUMN_WIDTH = 8;

const WHITESPACE_RE = /\s+/g;

type PreparedValue = string | number | boolean | string[] | undefined;

export class OutputConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OutputConfigError";
        Object.setPrototypeOf(this, OutputConfigError.prototype);
    }
}

/** Collapse every run of whitespace (newlines and tabs included) to one space, then strip. */
const collapseWhitespace = (value: string): string => value.replace(WHITESPACE_RE, " ").trim();

/**
 * Return a value ready for serialization, collapsing whitespace unless raw is set. Strings are
 * collapsed; lists have each element stringified and collapsed; every other type is returned
 * unchanged so the serializer handles it.
 */
const prepareValue = (value: unknown, raw: boolean): PreparedValue => {
    if (typeof value === "string") {
        return raw ? value : collapseWhitespace(value);
    }
    if (Array.isArray(value)) {
        const items = value.map(item => String(item));
        return raw ? items : items.map(collapseWhitespace);
    }
    if (typeof value === "number" || typeof value === "boolean" || value === undefined) {
        return value;
    }
    return value === null ? undefined : String(value);
};

/** Project an event onto an ordered, index-addressable record over all IData fields. */
const toLookup = (data: IData): Record<string, unknown> =>
    Object.fromEntries(DATA_FIELDS.map(field => [field, data[field]]));

/** Resolve the effective output format from the explicit flag, the path, or the tty. */
export const resolveFormat = (config: CliConfig): string => {
    const destinationIsFile = Boolean(config.outPath) && config.outPath !== "-";

    let resolved: string;
    if (config.outFormat) {
        resolved = config.outFormat;
    } else if (destinationIsFile) {
        const extension = path.extname(config.outPath ?? "").toLowerCase();
        resolved = EXTENSION_FORMATS[extension] ?? DEFAULT_STRUCTURED_FORMAT;
    } else {
        resolved = process.stdout.isTTY ? "table" : DEFAULT_STRUCTURED_FORMAT;
    }

    // A table only makes sense on stdout; a file destination downgrades it.
    if (resolved === "table" && destinationIsFile) {
        resolved = DEFAULT_STRUCTURED_FORMAT;
    }

    return resolved;
};

/** Resolve the ordered list of fields to emit for the given format. */
export const resolveFields = (config: CliConfig, outputFormat: string): string[] => {
    const available: string[] = [...DATA_FIELDS];

    if (config.fields && config.fields.length) {
        for (const name of config.fields) {
            if (!available.includes(name)) {
                throw new OutputConfigError(
                    `unknown field '${name}' (choose from ${available.join(", ")})`,
                );
            }
        }
        return [...config.fields];
    }

    if (config.allFields) {
        return available;
    }

    if (outputFormat === "table") {
        return [...TABLE_DEFAULT_FIELDS];
    }

    return available;
};

/** Decide whether ANSI colour may be emitted, honouring --no-color, NO_COLOR and the tty. */
const useColor = (config: CliConfig): boolean => {
    if (config.noColor || process.env["NO_COLOR"]) {
        return false;
    }
    return Boolean(process.stdout.isTTY);
};

/** Decide whether OSC 8 terminal hyperlinks may be emitted, gated only on the tty. */
const useHyperlinks = (): boolean => Boolean(process.stdout.isTTY);

interface Destination {
    write(text: string): void;
    close(): void;
}

/** Open the run's destination: a file for a real path, otherwise stdout. */
const openDestination = (outPath: string | undefined): Destination => {
    if (outPath && outPath !== "-") {
        const fd = fs.openSync(outPath, "w");
        return {
            write: (text: string) => {
                fs.writeSync(fd, text);
            },
            close: () => fs.closeSync(fd),
        };
    }
    return {
        write: (text: string) => {
            process.stdout.write(text);
        },
        close: () => undefined,
    };
};

export interface Writer {
    begin(): void;
    write(data: IData): void;
    end(): void;
}

/** Base for writers that stream to stdout or to a path opened for the run's duration. */
abstract class FileBackedWriter implements Writer {
    protected _destination: Destination | null = null;

    constructor(
        protected readonly _fields: string[],
        protected readonly _raw: boolean,
        protected readonly _outPath: string | undefined,
        protected readonly _spinner: Spinner,
    ) {}

    protected _record(data: IData): Record<string, PreparedValue> {
        const source = toLookup(data);
        const record: Record<string, PreparedValue> = {};
        for (const name of this._fields) {
            record[name] = prepareValue(source[name], this._raw);
        }
        return record;
    }

    abstract begin(): void;
    abstract write(data: IData): void;
    abstract end(): void;
}

/** Coerce a prepared value to what JSON should carry, mapping undefined onto null. */
const jsonValue = (value: PreparedValue): string | number | boolean | string[] | null =>
    value === undefined ? null : value;

class JsonlWriter extends FileBackedWriter {
    begin(): void {
        this._destination = openDestination(this._outPath);
    }

    write(data: IData): void {
        const destination = this._destination;
        if (!destination) {
            return;
        }
        const record: Record<string, string | number | boolean | string[] | null> = {};
        const prepared = this._record(data);
        for (const name of this._fields) {
            record[name] = jsonValue(prepared[name]);
        }
        this._spinner.pause(() => {
            destination.write(JSON.stringify(record) + "\n");
        });
    }

    end(): void {
        this._destination?.close();
        this._destination = null;
    }
}

class JsonWriter extends FileBackedWriter {
    private _first = true;

    begin(): void {
        this._destination = openDestination(this._outPath);
        this._first = true;
        this._destination.write("[");
    }

    write(data: IData): void {
        const destination = this._destination;
        if (!destination) {
            return;
        }
        const record: Record<string, string | number | boolean | string[] | null> = {};
        const prepared = this._record(data);
        for (const name of this._fields) {
            record[name] = jsonValue(prepared[name]);
        }
        const text = JSON.stringify(record, null, 2);
        const indented = text
            .split("\n")
            .map(line => "  " + line)
            .join("\n");
        this._spinner.pause(() => {
            destination.write(this._first ? "\n" : ",\n");
            destination.write(indented);
            this._first = false;
        });
    }

    end(): void {
        const destination = this._destination;
        if (destination) {
            if (!this._first) {
                destination.write("\n");
            }
            destination.write("]\n");
            destination.close();
        }
        this._destination = null;
    }
}

/** Quote a CSV field when it carries a quote, comma, or line break, doubling interior quotes. */
const csvEscape = (field: string): string => {
    if (/["\r\n,]/.test(field)) {
        return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
};

class CsvWriter extends FileBackedWriter {
    begin(): void {
        this._destination = openDestination(this._outPath);
        this._destination.write(this._fields.map(csvEscape).join(",") + "\r\n");
    }

    write(data: IData): void {
        const destination = this._destination;
        if (!destination) {
            return;
        }
        const record = this._record(data);
        const row = this._fields.map(name => {
            const value = record[name];
            if (Array.isArray(value)) {
                return value.join(STRUCTURED_LIST_SEPARATOR);
            }
            if (value === undefined) {
                return "";
            }
            return String(value);
        });
        this._spinner.pause(() => {
            destination.write(row.map(csvEscape).join(",") + "\r\n");
        });
    }

    end(): void {
        this._destination?.close();
        this._destination = null;
    }
}

/** Render a prepared value as a single human-readable string for table output. */
const stringifyCell = (value: PreparedValue): string => {
    if (Array.isArray(value)) {
        return value.join(TABLE_LIST_SEPARATOR);
    }
    if (value === undefined) {
        return "";
    }
    return String(value);
};

class TableWriter implements Writer {
    private _vertical: boolean;
    private _widths: number[] = [];
    private _recordIndex = 0;
    private _currentSection: string | null = null;
    private _sectionJobCount = 0;

    constructor(
        private readonly _fields: string[],
        private readonly _raw: boolean,
        private readonly _forcedVertical: boolean,
        private readonly _useColor: boolean,
        private readonly _useHyperlinks: boolean,
        private readonly _spinner: Spinner,
    ) {
        this._vertical = _forcedVertical;
    }

    private _prepared(data: IData): Record<string, PreparedValue> {
        const source = toLookup(data);
        const record: Record<string, PreparedValue> = {};
        for (const name of this._fields) {
            record[name] = prepareValue(source[name], this._raw);
        }
        return record;
    }

    private _decorate(text: string): string {
        return this._useColor ? `${ANSI_BOLD}${text}${ANSI_RESET}` : text;
    }

    private static _truncate(text: string, width: number): string {
        if (width <= 0) {
            return "";
        }
        if (text.length <= width) {
            return text;
        }
        if (width === 1) {
            return text.slice(0, 1);
        }
        return text.slice(0, width - 1) + TABLE_ELLIPSIS;
    }

    private static _fit(text: string, width: number): string {
        return TableWriter._truncate(text, width).padEnd(width);
    }

    private _computeLayout(): void {
        const columns = process.stdout.columns ?? 80;
        const fieldCount = this._fields.length;
        const separators = TABLE_COLUMN_SEPARATOR.length * Math.max(fieldCount - 1, 0);
        const minimum = fieldCount * TABLE_MIN_COLUMN_WIDTH + separators;

        if (this._forcedVertical || columns < minimum) {
            this._vertical = true;
            return;
        }

        this._vertical = false;
        const available = Math.max(columns - separators, fieldCount);
        const base = Math.floor(available / fieldCount);
        const remainder = available % fieldCount;
        this._widths = this._fields.map((_field, i) => base + (i < remainder ? 1 : 0));
    }

    begin(): void {
        this._recordIndex = 0;
        this._computeLayout();
    }

    private _headerCell(name: string, width: number): string {
        if (this._useColor) {
            const label = TableWriter._truncate(name, width);
            const pad = " ".repeat(Math.max(width - label.length, 0));
            return `${ANSI_BOLD}${label}${ANSI_RESET}` + pad;
        }
        return TableWriter._fit(name, width);
    }

    private _beginSection(): void {
        if (this._vertical) {
            return;
        }
        const header = this._fields
            .map((name, i) => this._headerCell(name, this._widths[i]))
            .join(TABLE_COLUMN_SEPARATOR);
        const rule = this._widths
            .map(width => "─".repeat(width))
            .join(TABLE_COLUMN_SEPARATOR);
        this._spinner.pause(() => {
            process.stdout.write(header + "\n");
            process.stdout.write(rule + "\n");
        });
    }

    write(data: IData): void {
        const section = JSON.stringify([data.query, data.location]);
        if (section !== this._currentSection) {
            this._currentSection = section;
            this._sectionJobCount = 0;
            this._beginSection();
        }

        this._recordIndex += 1;
        const record = this._prepared(data);
        if (this._vertical) {
            this._writeVertical(record);
        } else {
            this._writeRow(record);
        }
    }

    private _linkStyle(cell: string): string {
        return this._useColor ? `${ANSI_LINK}${cell}${ANSI_RESET}` : cell;
    }

    private _writeRow(record: Record<string, PreparedValue>): void {
        const cells: string[] = [];
        this._fields.forEach((name, i) => {
            const width = this._widths[i];
            const value = stringifyCell(record[name]);
            if (isHyperlinkField(name) && value && this._useHyperlinks) {
                const label = TableWriter._truncate(compactUrl(value), width);
                const pad = " ".repeat(Math.max(width - label.length, 0));
                const styled = this._useColor ? `${ANSI_LINK}${label}${ANSI_RESET}` : label;
                cells.push(hyperlink(value, styled) + pad);
            } else if (isHyperlinkField(name) && value) {
                cells.push(this._linkStyle(TableWriter._fit(value, width)));
            } else if (this._useColor && name in FIELD_COLORS) {
                const label = TableWriter._truncate(value, width);
                const pad = " ".repeat(Math.max(width - label.length, 0));
                cells.push(`${FIELD_COLORS[name]}${label}${ANSI_RESET}` + pad);
            } else {
                cells.push(TableWriter._fit(value, width));
            }
        });
        this._spinner.pause(() => {
            process.stdout.write(cells.join(TABLE_COLUMN_SEPARATOR) + "\n");
        });
    }

    private _writeVertical(record: Record<string, PreparedValue>): void {
        const keyWidth = Math.max(...this._fields.map(name => name.length));
        this._spinner.pause(() => {
            if (this._sectionJobCount > 0) {
                process.stdout.write("\n");
            }
            process.stdout.write(this._decorate(`── Job ${this._recordIndex} ──`) + "\n");
            for (const name of this._fields) {
                const value = stringifyCell(record[name]);
                let rendered: string;
                if (isHyperlinkField(name) && value) {
                    rendered = this._linkStyle(value);
                    if (this._useHyperlinks) {
                        rendered = hyperlink(value, rendered);
                    }
                } else if (this._useColor && name in FIELD_COLORS && value) {
                    rendered = `${FIELD_COLORS[name]}${value}${ANSI_RESET}`;
                } else {
                    rendered = value;
                }
                process.stdout.write(`${name.padEnd(keyWidth)}: ${rendered}\n`);
            }
        });
        this._sectionJobCount += 1;
    }

    end(): void {
        return undefined;
    }
}

/** Resolve format and fields from the config and construct the matching writer. */
export const createWriter = (config: CliConfig, spinner: Spinner): Writer => {
    const outputFormat = resolveFormat(config);
    const fields = resolveFields(config, outputFormat);

    if (outputFormat === "jsonl") {
        return new JsonlWriter(fields, config.raw, config.outPath, spinner);
    }
    if (outputFormat === "json") {
        return new JsonWriter(fields, config.raw, config.outPath, spinner);
    }
    if (outputFormat === "csv") {
        return new CsvWriter(fields, config.raw, config.outPath, spinner);
    }
    if (outputFormat === "table") {
        return new TableWriter(
            fields,
            config.raw,
            config.vertical,
            useColor(config),
            useHyperlinks(),
            spinner,
        );
    }

    throw new OutputConfigError(`unsupported output format '${outputFormat}'`);
};
