import { config } from "../config";

export const relevanceFilter = {
    RELEVANT: "R",
    RECENT: "DD",
}

export const timeFilter = {
    ANY: "",
    DAY: config.LI_AT_COOKIE ? "r86400" : "1",
    WEEK: config.LI_AT_COOKIE ? "r604800" : "1,2",
    MONTH: config.LI_AT_COOKIE ? "r2592000" : "1,2,3,4",
}

export const typeFilter = {
    FULL_TIME: "F",
    PART_TIME: "P",
    TEMPORARY: "T",
    CONTRACT: "C",
    INTERNSHIP: "I",
}

export const experienceLevelFilter = {
    INTERNSHIP: "1",
    ENTRY_LEVEL: "2",
    ASSOCIATE: "3",
    MID_SENIOR: "4",
    DIRECTOR: "5",
}
