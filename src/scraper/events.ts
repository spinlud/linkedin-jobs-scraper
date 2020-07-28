type BrowserEvent = "disconnected" | "targetchanged" | "targetcreated" | "targetdestroyed";

export interface IData {
    query: string;
    location: string;
    link: string;
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

const events = {
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

export { events };
