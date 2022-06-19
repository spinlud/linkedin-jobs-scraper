import { getQueryParams } from "../utils/url";
import {
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    remoteFilter,
} from "./filters";

export interface IQuery {
    query?: string;
    options?: IQueryOptions;
}

export interface IQueryOptions {
    locations?: string[];
    limit?: number;
    filters?: {
        companyJobsUrl?: string;
        relevance?: string;
        time?: string;
        type?: string | string[];
        experience?: string | string[];
        remote?: string;
    },
    descriptionFn?: () => string;
    optimize?: boolean;
    applyLink?: boolean;
}

export interface IQueryValidationError {
    param: string;
    reason: string;
}

/**
 * Validate query
 * @param {IQuery} query
 * @returns {IQueryValidationError[]}
 */
export const validateQuery = (query: IQuery): IQueryValidationError[] => {
    const errors: IQueryValidationError[] = [];

    if (query.query && typeof(query.query) !== "string") {
        errors.push({
            param: "query",
            reason: `Must be a string`
        });
    }

    if (query.options) {
        const {
            locations,
            filters,
            descriptionFn,
            limit,
        } = query.options;

        if (locations && (!Array.isArray(locations) || !locations.every(e => typeof(e) === "string"))) {
            errors.push({
                param: "options.locations",
                reason: `Must be an array of strings`
            });
        }

        if (descriptionFn && typeof(descriptionFn) !== "function") {
            errors.push({
                param: "options.descriptionFn",
                reason: `Must be a function`
            });
        }

        if (query.options.hasOwnProperty("optimize") && typeof(query.options.optimize) !== "boolean") {
            errors.push({
                param: "options.optimize",
                reason: `Must be a boolean`
            });
        }

        if (query.options.hasOwnProperty("applyLink") && typeof(query.options.applyLink) !== "boolean") {
            errors.push({
                param: "options.applyLink",
                reason: `Must be a boolean`
            });
        }

        if (limit && (!Number.isInteger(limit) || limit <= 0)) {
            errors.push({
                param: "options.limit",
                reason: `Must be a positive integer`
            });
        }

        if (filters) {
            if (filters.companyJobsUrl) {
                if (typeof(filters.companyJobsUrl) !== "string") {
                    errors.push({
                        param: "options.filters.companyUrl",
                        reason: `Must be a string`
                    });
                }

                try {
                    const baseUrl = "https://www.linkedin.com/jobs/search/?";
                    new URL(filters.companyJobsUrl); // Check url validity
                    const queryParams = getQueryParams(filters.companyJobsUrl);

                    if (!filters.companyJobsUrl.toLowerCase().startsWith(baseUrl)
                        || !queryParams.hasOwnProperty("f_C") || !queryParams["f_C"]) {
                        errors.push({
                            param: "options.filters.companyJobsUrl",
                            reason: `Url is invalid. Please check the documentation on how find a company jobs link from LinkedIn`
                        });
                    }
                }
                catch(err: any) {
                    errors.push({
                        param: "options.filters.companyJobsUrl",
                        reason: `Must be a valid url`
                    });
                }
            }

            if (filters.relevance) {
                const allowed = Object.values(relevanceFilter);

                if (!allowed.includes(filters.relevance)) {
                    errors.push({
                        param: "options.filters.relevance",
                        reason: `Must be one of ${allowed.join(", ")}`
                    });
                }
            }

            if (filters.time) {
                const allowed = Object.values(timeFilter);

                if (!allowed.includes(filters.time)) {
                    errors.push({
                        param: "options.filters.time",
                        reason: `Must be one of ${allowed.join(", ")}`
                    });
                }
            }

            if (filters.type) {
                const allowed = Object.values(typeFilter);

                if (!Array.isArray(filters.type)) {
                    filters.type = [filters.type];
                }

                for (const t of filters.type) {
                    if (!allowed.includes(t)) {
                        errors.push({
                            param: "options.filters.type",
                            reason: `Must be one of ${allowed.join(", ")}`
                        });
                    }
                }
            }

            if (filters.experience) {
                const allowed = Object.values(experienceLevelFilter);

                if (!Array.isArray(filters.experience)) {
                    filters.experience = [filters.experience];
                }

                for (const t of filters.experience) {
                    if (!allowed.includes(t)) {
                        errors.push({
                            param: "options.filters.experience",
                            reason: `Must be one of ${allowed.join(", ")}`
                        });
                    }
                }
            }

            if (filters.remote) {
                const allowed = Object.values(remoteFilter);

                if (!allowed.includes(filters.remote)) {
                    errors.push({
                        param: "options.filters.remote",
                        reason: `Must be one of ${allowed.join(", ")}`
                    });
                }
            }
        }
    }

    return errors;
}
