import {
    ERelevanceFilterOptions,
    ETimeFilterOptions,
    EJobTypeFilterOptions,
    EExperienceLevelOptions,
} from "./filters";
import {getQueryParams} from "../utils/url";

export interface IQuery {
    query?: string;
    options?: IQueryOptions;
}

export interface IQueryOptions {
    locations?: string[];
    limit?: number;
    filters?: {
        companyJobsUrl?: string;
        relevance?: ERelevanceFilterOptions;
        time?: ETimeFilterOptions;
        type?: EJobTypeFilterOptions;
        experience?: EExperienceLevelOptions;
    },
    descriptionFn?: () => string;
    optimize?: boolean;
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
                    new URL(filters.companyJobsUrl); // CHeck url validity
                    const queryParams = getQueryParams(filters.companyJobsUrl);

                    if (!filters.companyJobsUrl.toLowerCase().startsWith(baseUrl)
                        || !queryParams.hasOwnProperty("f_C") || !queryParams["f_C"]) {
                        errors.push({
                            param: "options.filters.companyJobsUrl",
                            reason: `Url is invalid. Please check the documentation on how find a company jobs link from LinkedIn`
                        });
                    }
                }
                catch(err) {
                    errors.push({
                        param: "options.filters.companyJobsUrl",
                        reason: `Must be a valid url`
                    });
                }
            }
        }
    }

    return errors;
}
