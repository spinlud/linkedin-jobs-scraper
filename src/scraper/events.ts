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
    companyImgLink?: string;
    place: string;
    date: string;
    description: string;
    descriptionHTML: string;
    insights: string[];
}

interface IEvents {
    scraper: {
        data: "scraper:data";
        error: "scraper:error";
        invalidSession: "scraper:invalid-session",
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
        invalidSession: "scraper:invalid-session",
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

// export interface IEventListeners extends EventMap {
//     ["scraper:data"]: (data: IData) => void;
//     ["scraper:error"]: (error: Error | string) => void;
//     ["scraper:invalid-session"]: () => void;
//     ["scraper:end"]: () => void;
//     ["disconnected"]: (...args: any[]) => void;
//     ["targetchanged"]: (...args: any[]) => void;
//     ["targetcreated"]: (...args: any[]) => void;
//     ["targetdestroyed"]: (...args: any[]) => void;
// }

export type IEventListeners = {
    ["scraper:data"]: (data: IData) => void;
    ["scraper:error"]: (error: Error | string) => void;
    ["scraper:invalid-session"]: () => void;
    ["scraper:end"]: () => void;
    ["disconnected"]: (...args: any[]) => void;
    ["targetchanged"]: (...args: any[]) => void;
    ["targetcreated"]: (...args: any[]) => void;
    ["targetdestroyed"]: (...args: any[]) => void;
}

export { events };
