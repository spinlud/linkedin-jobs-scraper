import { IData } from "../scraper/events";

/**
 * Canonical IData field order. Every field-ordered concern in the CLI keys off this single
 * list: colour assignment, --all-fields, the default table selection, and structured key order.
 * It must stay in lockstep with the IData interface in the scraper.
 */
export const DATA_FIELDS = [
    "query",
    "location",
    "jobId",
    "jobIndex",
    "link",
    "applyLink",
    "title",
    "company",
    "companyLink",
    "companyEmployeeCount",
    "companyImgLink",
    "place",
    "date",
    "dateText",
    "description",
    "descriptionHTML",
    "insights",
    "salary",
    "isEasyApply",
    "applicantCount",
    "benefits",
    "reposted",
] as const satisfies readonly (keyof IData)[];

export type DataField = (typeof DATA_FIELDS)[number];

/** Fields whose values are URLs, rendered as clickable terminal hyperlinks in the table. */
export const HYPERLINK_FIELDS = [
    "link",
    "applyLink",
    "companyLink",
    "companyImgLink",
] as const satisfies readonly DataField[];

export const isHyperlinkField = (name: string): boolean =>
    (HYPERLINK_FIELDS as readonly string[]).includes(name);
