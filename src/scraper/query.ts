import { getQueryParams } from "../utils/url";
import {
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    onSiteOrRemoteFilter,
    industryFilter,
} from "./filters";

export interface IQuery {
    query?: string;
    options?: IQueryOptions;
}

export interface IQueryOptions {
    locations?: string[];
    pageOffset?: number;
    limit?: number;
    filters?: {
        companyJobsUrl?: string;
        relevance?: string;
        time?: string;
        type?: string | string[];
        experience?: string | string[];
        onSiteOrRemote?: string | string[];
        industry?: string | string[];
    },
    descriptionFn?: () => string;
    optimize?: boolean;
    applyLink?: boolean;
    skipPromotedJobs?: boolean;
    skills?: boolean;
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
            pageOffset,
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

        if (query.options.hasOwnProperty("skipPromotedJobs") && typeof(query.options.skipPromotedJobs) !== "boolean") {
            errors.push({
                param: "options.skipPromotedJobs",
                reason: `Must be a boolean`
            });
        }

        if (query.options.hasOwnProperty("skills") && typeof(query.options.skills) !== "boolean") {
            errors.push({
                param: "options.skills",
                reason: `Must be a boolean`
            });
        }

        if (pageOffset && (!Number.isInteger(pageOffset) || pageOffset <= 0)) {
            errors.push({
                param: "options.pageOffset",
                reason: `Must be a positive integer`
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

            if (filters.onSiteOrRemote) {
                const allowed = Object.values(onSiteOrRemoteFilter);

                if (!Array.isArray(filters.onSiteOrRemote)) {
                    filters.onSiteOrRemote = [filters.onSiteOrRemote];
                }

                for (const t of filters.onSiteOrRemote) {
                    if (!allowed.includes(t)) {
                        errors.push({
                            param: "options.filters.onSiteOrRemote",
                            reason: `Must be one of ${allowed.join(", ")}`
                        });
                    }
                }
            }

            if (filters.industry) {
                const allowed = Object.values(industryFilter);

                if (!Array.isArray(filters.industry)) {
                    filters.industry = [filters.industry];
                }

                for (const t of filters.industry) {
                    if (!allowed.includes(t)) {
                        errors.push({
                            param: "options.filters.industry",
                            reason: `Must be one of ${allowed.join(", ")}`
                        });
                    }
                }
            }
        }
    }

    return errors;
}
