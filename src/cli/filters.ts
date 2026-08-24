/**
 * Translation between the CLI's kebab-case filter tokens and the LinkedIn filter codes the
 * library expects.
 *
 * The scraper filter consts are keyed by enum-member name and valued by LinkedIn code. The CLI
 * tokens are those member names kebab-cased (declaration order preserved), which is exactly how
 * the Python CLI derives its choices, so the two cannot drift. Each map here is built from the
 * scraper const, so validation and translation share one source of truth.
 */
import {
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    onSiteOrRemoteFilter,
    industryFilter,
    baseSalaryFilter,
    jobFunctionFilter,
    benefitsFilter,
    commitmentsFilter,
} from "../scraper/filters";

/** Convert an enum-member name into its kebab-case CLI token. */
const memberToKebab = (name: string, stripPrefix = ""): string => {
    let base = name;
    if (stripPrefix && base.startsWith(stripPrefix)) {
        base = base.slice(stripPrefix.length);
    }
    return base.toLowerCase().replace(/_/g, "-");
};

export interface ChoiceMap {
    /** kebab token to LinkedIn code, in declaration order. */
    codes: Record<string, string>;
    /** kebab tokens in declaration order, for choices display. */
    order: string[];
}

/** Build a {kebab token: code} map generically from a scraper filter const. */
const buildChoiceMap = (filter: Record<string, string>, stripPrefix = ""): ChoiceMap => {
    const codes: Record<string, string> = {};
    const order: string[] = [];

    for (const [member, code] of Object.entries(filter)) {
        const token = memberToKebab(member, stripPrefix);
        codes[token] = code;
        order.push(token);
    }

    return { codes, order };
};

export const RELEVANCE_CHOICES = buildChoiceMap(relevanceFilter);
export const TIME_CHOICES = buildChoiceMap(timeFilter);
export const SALARY_CHOICES = buildChoiceMap(baseSalaryFilter, "SALARY_");
export const TYPE_CHOICES = buildChoiceMap(typeFilter);
export const EXPERIENCE_CHOICES = buildChoiceMap(experienceLevelFilter);
export const WORKPLACE_CHOICES = buildChoiceMap(onSiteOrRemoteFilter);
export const INDUSTRY_CHOICES = buildChoiceMap(industryFilter);
export const JOB_FUNCTION_CHOICES = buildChoiceMap(jobFunctionFilter);
export const BENEFITS_CHOICES = buildChoiceMap(benefitsFilter);
export const COMMITMENTS_CHOICES = buildChoiceMap(commitmentsFilter);

/**
 * Reject an unknown token the way argparse would, exiting the process directly so the parse-time
 * error carries an exit code of 2 and a message matching the Python CLI.
 * @param {string} flag
 * @param {string} token
 * @param {ChoiceMap} choices
 */
const rejectInvalidChoice = (flag: string, token: string, choices: ChoiceMap): never => {
    const allowed = choices.order.join(", ");
    process.stderr.write(
        `argument ${flag}: invalid choice: '${token}' (choose from ${allowed})\n`,
    );
    return process.exit(2);
};

/**
 * Build a commander argument parser that splits comma-separated tokens in one option and
 * accumulates across repeats, validating every token against the allowed kebab keys.
 * @param {string} flag
 * @param {ChoiceMap} choices
 * @returns {(value: string, previous: string[] | undefined) => string[]}
 */
export const commaSeparatedChoice =
    (flag: string, choices: ChoiceMap) =>
    (value: string, previous: string[] | undefined): string[] => {
        const items = previous ? [...previous] : [];

        for (const rawToken of value.split(",")) {
            const token = rawToken.trim();
            if (!token) {
                continue;
            }
            if (!(token in choices.codes)) {
                rejectInvalidChoice(flag, token, choices);
            }
            items.push(token);
        }

        return items;
    };

/**
 * Build a commander argument parser for a single-choice filter flag, validating the token
 * against the allowed kebab keys.
 * @param {string} flag
 * @param {ChoiceMap} choices
 * @returns {(value: string) => string}
 */
export const singleChoice =
    (flag: string, choices: ChoiceMap) =>
    (value: string): string => {
        const token = value.trim();
        if (!(token in choices.codes)) {
            rejectInvalidChoice(flag, token, choices);
        }
        return token;
    };

/** Translate accepted kebab tokens into their LinkedIn codes. */
export const tokensToCodes = (tokens: string[], choices: ChoiceMap): string[] =>
    tokens.map(token => choices.codes[token]);
