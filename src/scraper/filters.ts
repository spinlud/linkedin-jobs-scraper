export enum ERelevanceFilterOptions {
    RELEVANT = "RELEVANT",
    RECENT = "RECENT",
}

export enum ETimeFilterOptions {
    DAY = "DAY",
    WEEK = "WEEK",
    MONTH = "MONTH",
    ANY = "ANY",
}

export type RelevanceFilterOption = typeof ERelevanceFilterOptions[keyof typeof ERelevanceFilterOptions];
export type TimeFilterOption = typeof ETimeFilterOptions[keyof typeof ETimeFilterOptions];

interface IFilter {
    dropdownBtnSelector: string;
    choices: {
        [key: string]: number;
    }
}

interface IRelevanceFilter extends IFilter {
    choices: {
        [key in ERelevanceFilterOptions]: number;
    }
}

interface ITimeFilter extends IFilter {
    choices: {
        [key in ETimeFilterOptions]: number;
    }
}

export const relevanceFilter: IRelevanceFilter = {
    dropdownBtnSelector: '.top-filters__item button.filter-dropdown__button[data-tracking-control-name=public_jobs_-dropdown]',
    choices: {
        [ERelevanceFilterOptions.RELEVANT]: 0,
        [ERelevanceFilterOptions.RECENT]: 1,
    }
};

export const timeFilter: ITimeFilter = {
    dropdownBtnSelector: '.top-filters__item button.filter-dropdown__button[data-tracking-control-name=public_jobs_TIME_POSTED-dropdown]',
    choices: {
        [ETimeFilterOptions.DAY]: 0,
        [ETimeFilterOptions.WEEK]: 1,
        [ETimeFilterOptions.MONTH]: 2,
        [ETimeFilterOptions.ANY]: 3,
    }
};

export type FilterFnOptions = {
    dropdownBtnSelector: string;
    choiceIndex: number;
}

/**
 * Function executed on browser side to apply a filter
 * @param options {FilterFnOptions}
 * @returns {void}
 */
export const filterFn = (options: FilterFnOptions): void => {
    const dropdownBtn = document.querySelector<HTMLButtonElement>(options.dropdownBtnSelector)!;
    dropdownBtn.click();

    dropdownBtn.parentElement!
        .querySelectorAll<HTMLInputElement>('ul > li > input')[options.choiceIndex]!.click();

    dropdownBtn.parentElement!
        .querySelector<HTMLInputElement>('button.filter-button-dropdown__action')!.click();
};
