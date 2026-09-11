import { EventMap } from 'typed-emitter';

type BrowserEvent = "disconnected" | "targetchanged" | "targetcreated" | "targetdestroyed";

export interface IData {
    query: string;
    location: string;
    jobId: string;
    jobIndex: number; // Job index during search, only useful for debug
    link: string;
    applyLink?: string;
    title: string;
    company: string;
    companyLink?: string;
    companyEmployeeCount?: string;
    companyImgLink?: string;
    place: string;
    date: string; // ISO YYYY-MM-DD, from the <time> datetime attribute or the parsed fallback
    dateText: string; // Raw relative posted-date text (eg '2 weeks ago')
    description: string;
    descriptionHTML: string;
    insights: string[];
    salary?: string;
    isEasyApply: boolean;
    applicantCount?: string;
    benefits?: string[];
    reposted: boolean;
}

export interface IMetrics {
    processed: number;  // Number of successfully processed jobs
    failed: number;  // Number of jobs failed to process (because of an error)
    missed: number; // Number of missed jobs to load during scraping
    skipped: number; // Skipped jobs
    throttled: number; // Number of 429 (too many requests) responses reported to the shared pacer
    pace: number; // Current pacer delay in seconds
}

export interface IBegin {
    jobTotal: number; // Approximate total result count reported by LinkedIn
}

export interface INotFound {
    jobId: string; // Id of the job that could not be found
}

export interface ISession {
    liAt: string; // Refreshed li_at cookie, differing from the one supplied
}

interface IEvents {
    scraper: {
        data: "scraper:data";
        error: "scraper:error";
        metrics: "scraper:metrics";
        begin: "scraper:begin";
        notFound: "scraper:not-found";
        invalidSession: "scraper:invalid-session",
        sessionRefreshed: "scraper:session-refreshed";
        end: "scraper:end";
    },
    puppeteer: {
        browser: {
            disconnected: BrowserEvent;
            targetchanged: BrowserEvent;
            targetcreated: BrowserEvent;
            targetdestroyed: BrowserEvent;
        },
    },
}

const events: IEvents = {
    scraper: {
        data: "scraper:data",
        error: "scraper:error",
        metrics: "scraper:metrics",
        begin: "scraper:begin",
        notFound: "scraper:not-found",
        invalidSession: "scraper:invalid-session",
        sessionRefreshed: "scraper:session-refreshed",
        end: "scraper:end",
    },
    puppeteer: {
        browser: {
            disconnected: "disconnected" as BrowserEvent,
            targetchanged: "targetchanged" as BrowserEvent,
            targetcreated: "targetcreated" as BrowserEvent,
            targetdestroyed: "targetdestroyed" as BrowserEvent,
        },
    },
};

export type IEventListeners = {
    ["scraper:data"]: (data: IData) => void;
    ["scraper:error"]: (error: Error | string) => void;
    ["scraper:metrics"]: (data: IMetrics) => void;
    ["scraper:begin"]: (data: IBegin) => void;
    ["scraper:not-found"]: (data: INotFound) => void;
    ["scraper:invalid-session"]: () => void;
    ["scraper:session-refreshed"]: (data: ISession) => void;
    ["scraper:end"]: () => void;
    ["disconnected"]: (...args: any[]) => void;
    ["targetchanged"]: (...args: any[]) => void;
    ["targetcreated"]: (...args: any[]) => void;
    ["targetdestroyed"]: (...args: any[]) => void;
}

export { events };
