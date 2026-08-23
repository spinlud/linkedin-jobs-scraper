const urls = {
    home: "https://www.linkedin.com",
    jobs: "https://www.linkedin.com/jobs",
    jobsSearch: "https://www.linkedin.com/jobs/search"
};

// Attribute carrying the job id on each item of the results list. It is set on every item,
// including the ones whose card LinkedIn has not rendered yet, which makes it the only stable
// way to address a job in the virtualized list.
const JOB_ID_ATTRIBUTE = "data-occludable-job-id";

// Number of results LinkedIn serves per page, used to build the `start` query param.
const PAGINATION_SIZE = 25;

// LinkedIn stops serving results past start=1000, so an unlimited run (limit=0) paginates no
// further than this regardless of how many results the query reports.
const MAX_RESULTS_CEILING = 1000;

// Pause, in seconds, before the second attempt at opening a page of results.
const PAGINATION_RETRY_DELAY = 2;

// What LinkedIn answers a run that is going too fast with.
const THROTTLED_STATUS = 429;

// Waits, in seconds, before asking again for a page that came back throttled. Only time clears
// a 429, and a run that has already been told to slow down gets told again, so the wait grows.
const THROTTLE_BACKOFF_DELAYS = [5, 15, 45];

// Attempts refused at the same moment must not ask again at the same moment: the ladder keeps
// its shape and each wait is drawn around the step, rather than replacing it with a draw from
// zero.
const THROTTLE_BACKOFF_JITTER = 0.5;

// LinkedIn paints a preliminary list of results and replaces it about a second later with the
// real one, and the two do not hold the same jobs. Ids are therefore read only once the list
// has held still for this long (seconds).
const LIST_SETTLE_QUIET_PERIOD = 1;
const LIST_SETTLE_TIMEOUT = 8;
const LIST_SETTLE_POLL_INTERVAL = 0.1;

// The results list is filled progressively as it is scrolled, so its size is grown until it
// stops changing (seconds).
const LOAD_MORE_JOBS_POLL_INTERVAL = 0.05;
const LOAD_MORE_JOBS_TIMEOUT = 3;

// How long to wait for a virtualized card to render after scrolling it into view (seconds).
const LOAD_JOB_CARD_TIMEOUT = 5;
const LOAD_JOB_CARD_POLL_INTERVAL = 0.05;

// How long an item may be absent from the list before it is taken to have left it, rather than
// to be momentarily detached by a re-render (seconds).
const MISSING_ITEM_GRACE = 1;

// How long to wait for a page of results to render at least one item (seconds).
const CONTAINER_WAIT_TIMEOUT = 15;
const CONTAINER_WAIT_POLL_INTERVAL = 0.05;

// The floor of a floor: a run is never allowed to ask faster than this, whatever the pacer is
// doing (seconds).
const MIN_SLOW_MO = 0.2;

// Default seconds slept between jobs, the floor the pacer never eases below.
const DEFAULT_BASE_DELAY = 0.8;

// The pace rises at most to `baseDelay * PACING_CEILING_FACTOR`, and never past
// PACING_CEILING_LIMIT seconds however patient the caller asked to be.
const PACING_CEILING_LIMIT = 10;
const PACING_CEILING_FACTOR = 10;

// A 429 doubles the pace.
const PACING_INCREASE_FACTOR = 2;

// Easing is deliberately slower than raising, and has to be earned by a run of work that
// nobody refused.
const PACING_EASE_FACTOR = 1.5;
const CLEAN_RUN_BEFORE_EASING = 20;

export {
    urls,
    JOB_ID_ATTRIBUTE,
    PAGINATION_SIZE,
    MAX_RESULTS_CEILING,
    PAGINATION_RETRY_DELAY,
    THROTTLED_STATUS,
    THROTTLE_BACKOFF_DELAYS,
    THROTTLE_BACKOFF_JITTER,
    LIST_SETTLE_QUIET_PERIOD,
    LIST_SETTLE_TIMEOUT,
    LIST_SETTLE_POLL_INTERVAL,
    LOAD_MORE_JOBS_POLL_INTERVAL,
    LOAD_MORE_JOBS_TIMEOUT,
    LOAD_JOB_CARD_TIMEOUT,
    LOAD_JOB_CARD_POLL_INTERVAL,
    MISSING_ITEM_GRACE,
    CONTAINER_WAIT_TIMEOUT,
    CONTAINER_WAIT_POLL_INTERVAL,
    MIN_SLOW_MO,
    DEFAULT_BASE_DELAY,
    PACING_CEILING_LIMIT,
    PACING_CEILING_FACTOR,
    PACING_INCREASE_FACTOR,
    PACING_EASE_FACTOR,
    CLEAN_RUN_BEFORE_EASING,
};
