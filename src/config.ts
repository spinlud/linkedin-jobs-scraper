const config = {
    LI_AT_COOKIE: process.env["LI_AT_COOKIE"] ? process.env["LI_AT_COOKIE"] : undefined,

    // Remember-me credential: the li_rm cookie and the browser id it was issued to. Supplied
    // together they let LinkedIn mint a fresh li_at, so a run recovers on its own from a
    // retired session. Only meaningful as a pair.
    LI_RM_COOKIE: process.env["LI_RM_COOKIE"] ? process.env["LI_RM_COOKIE"] : undefined,
    LI_BCOOKIE: process.env["LI_BCOOKIE"] ? process.env["LI_BCOOKIE"] : undefined,
};

export {
    config,
};
