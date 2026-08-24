/**
 * Extract query params from url
 * @param {string} url
 * @returns { [key: string]: string }
 */
const getQueryParams = (url: string): { [key: string]: string } => {
    const params: { [key: string]: string } = {};
    const parsed = new URL(url);
    const search = parsed.search.substr(1);
    const tokens = search.split("&");

    for (const t of tokens) {
        const [key, value] = t.split("=");
        params[key] = decodeURIComponent(value);
    }

    return params;
};

/**
 * Extract a LinkedIn job id from a bare id or a job url
 * @param {string} urlOrId a numeric id, a '/jobs/view/<id>' url or a '?currentJobId=<id>' url
 * @returns {string}
 * @throws {Error} when no job id can be extracted from the input
 */
const getJobId = (urlOrId: string): string => {
    const value = urlOrId.trim();

    if (/^\d+$/.test(value)) {
        return value;
    }

    const viewMatch = value.match(/\/jobs\/view\/(\d+)/);

    if (viewMatch) {
        return viewMatch[1];
    }

    try {
        const currentJobId = getQueryParams(value)["currentJobId"];

        if (currentJobId && /^\d+$/.test(currentJobId)) {
            return currentJobId;
        }
    }
    catch (err) {
        // The input is not a parseable url, fall through to the thrown error below
    }

    throw new Error(`Could not extract a job id from ${JSON.stringify(urlOrId)}`);
};

export {
    getQueryParams,
    getJobId,
};
