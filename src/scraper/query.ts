import {
    ERelevanceFilterOptions,
    ETimeFilterOptions,
    EJobTypeFilterOptions,
    EExperienceLevelOptions,
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
        relevance?: ERelevanceFilterOptions;
        time?: ETimeFilterOptions;
        type?: EJobTypeFilterOptions;
        experience?: EExperienceLevelOptions;
    },
    descriptionFn?: () => string;
    optmize?: boolean;
}

export interface IQueryValidationError {
    param: string;
    reason: string;
}
