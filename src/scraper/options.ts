import { RelevanceFilterOption, TimeFilterOption } from "./filters";

export interface IRunOptions {
    paginationMax?: number; // Limit jobs pagination
    descriptionProcessor?: () => string; // Custom function to extract job description on browser side
    filter?: {
        relevance?: RelevanceFilterOption;
        time?: TimeFilterOption;
    }
    optimize?: boolean; // Block resources such as images, stylesheets etc to improve bandwidth usage
}
