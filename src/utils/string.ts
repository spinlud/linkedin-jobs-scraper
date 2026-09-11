export const normalizeString = (s: string): string => {
    return s.replace(/[\n\r\t ]+/g, ' ').trim();
}

// The applicant clause inside the tertiary description container, one of:
// "N applicants" / "Over N applicants" / "N+ applicants" /
// "N people clicked apply" / "Over N people clicked apply" (N may contain commas).
const APPLICANT_CLAUSE_RE = /(over\s+)?[\d,]+\+?\s+(?:applicants?|people clicked apply)/i;

/**
 * Reduce the raw applicant segment to just the applicant clause.
 * The tertiary description container is not always separated by "·" from adjacent
 * badges (eg "Over 100 people clicked apply Promoted by hirer"), so the raw segment can
 * carry trailing text. Returns the first matching applicant clause with normalized
 * whitespace, or an empty string when nothing matches.
 * @param {string} text
 * @returns {string}
 */
export const cleanApplicantCount = (text: string): string => {
    if (!text) {
        return "";
    }

    const match = APPLICANT_CLAUSE_RE.exec(text);

    if (match) {
        return normalizeString(match[0]).trim();
    }

    return "";
}
