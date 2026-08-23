// Derive an approximate ISO date from LinkedIn's relative posted-date text.
// The job detail panel exposes no machine-readable date, only relative text such as
// "Reposted 8 hours ago" or "2 weeks ago". These helpers turn that text into an
// approximate 'YYYY-MM-DD' string. They are pure so they can be unit-tested without a
// browser; the current time is injected rather than read internally.

// Days assumed per unit. Weeks, months and years are approximations, since the relative
// text carries no exact date.
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Leading "Posted"/"Reposted" prefix LinkedIn puts in front of the relative text.
const LEADING_PREFIX_RE = /^\s*re?posted\b/i;

// "just now" and sub-hour granularities all resolve to the current day.
const TODAY_RE = /\b(just now|\d+\s+(?:minute|hour)s?\s+ago)\b/i;

// "N <unit> ago" where the unit is day/week/month/year.
const RELATIVE_RE = /(\d+)\s+(day|week|month|year)s?\s+ago/i;

const UNIT_DAYS: Record<string, number> = {
    day: 1,
    week: DAYS_PER_WEEK,
    month: DAYS_PER_MONTH,
    year: DAYS_PER_YEAR,
};

const toIsoDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * Return an approximate ISO 'YYYY-MM-DD' date for LinkedIn's relative date text.
 * A leading "Posted"/"Reposted" prefix is stripped. "just now" and minute/hour
 * granularities resolve to now's date; day/week/month/year subtract the corresponding
 * number of days (weeks, months and years approximated at 7, 30 and 365 days). Returns
 * an empty string when nothing matches.
 * @param {string} text
 * @param {Date} now
 * @returns {string}
 */
export const parseRelativeDate = (text: string, now: Date): string => {
    if (!text) {
        return "";
    }

    const stripped = text.replace(LEADING_PREFIX_RE, "").trim();

    if (TODAY_RE.test(stripped)) {
        return toIsoDate(now);
    }

    const match = RELATIVE_RE.exec(stripped);

    if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        const days = amount * UNIT_DAYS[unit];
        return toIsoDate(new Date(now.getTime() - days * MILLISECONDS_PER_DAY));
    }

    return "";
};
