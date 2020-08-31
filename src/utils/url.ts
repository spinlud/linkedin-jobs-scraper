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

export {
    getQueryParams,
};
