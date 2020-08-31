type BrowserEvent = "disconnected" | "targetchanged" | "targetcreated" | "targetdestroyed";

export interface IData {
    query: string;
    location: string;
    link: string;
    applyLink?: string;
    title: string;
    company: string;
    place: string;
    date: string;
    description: string;
    senorityLevel: string;
    jobFunction: string;
    employmentType: string;
    industries: string;
}

interface IEvents {
    scraper: {
        data: "scraper:data";
        error: "scraper:error";
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

export interface IEventListeners {
    ["scraper:data"]: (data: IData) => void;
    ["scraper:error"]: (error: Error | string) => void;
    ["scraper:end"]: () => void;
    ["disconnected"]: (...args: any[]) => void;
    ["targetchanged"]: (...args: any[]) => void;
    ["targetcreated"]: (...args: any[]) => void;
    ["targetdestroyed"]: (...args: any[]) => void;
}

export { events };
