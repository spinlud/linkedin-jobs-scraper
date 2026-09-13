# Context: linkedin-jobs-scraper (Node)

Glossary for the LinkedIn jobs scraping domain. Implementation details live in code, not here.

## Terms

- **Parity target** — the Python sibling `py-linkedin-jobs-scraper` **v7.0.10**, pinned as of 2026-08-23. The Node package intentionally mirrors its features. Later Python drift is a separate effort, not a moving target.
- **Strategy** — an approach for driving a scrape session. After v19 only the **authenticated strategy** exists; the anonymous (no-credential) strategy is removed.
- **Credential** — one of the three authenticated inputs: an **interactive profile** (a persisted Chrome `userDataDir` from a one-time sign-in), a **remember-me pair**, or a bare **`li_at` cookie**.
- **Remember-me pair** — `li_rm` + `bcookie` cookies supplied together. LinkedIn mints a fresh `li_at` from them on any authenticated route; self-renews (~1 year). The non-interactive preferred credential.
- **`li_at` cookie** — the bare session cookie. Copyable from devtools but cannot self-renew; LinkedIn retires it after ~100 job loads.
- **Session recovery** — mid-run re-authentication when the session is lost, retrying with the configured credential a bounded number of times before giving up.
- **Session refresh** — when the ending `li_at` differs from the one supplied, the new value is surfaced (`scraper.sessionRefreshed`) so the caller can persist it.
- **UA masking** — stripping the `HeadlessChrome` token and `navigator.webdriver` so the automated browser does not look automated.
- **Authwall** — LinkedIn's guest/sign-in gate, rendered when no valid session is honored (detected by page markers, not by the cookie jar alone, since a cookie present in the jar does not mean LinkedIn accepted it). Kept distinct from a **throttle** (HTTP 429) response: both leave an effectively unauthenticated page, but an authwall means re-authenticate while a throttle means back off.
- **List settling** — waiting for LinkedIn's virtualized results list to stop repainting (it renders a preliminary partial list before the settled one) before reading job cards.
- **Job id addressing** — locating job cards by their `data-occludable-job-id` attribute rather than DOM position, because the list is virtualized.
- **Throttle backoff** — the jittered delay ladder applied after an HTTP 429, paired with an adaptive pacer that slows down under throttling and eases back when clean.
- **Unbounded scrape** — `limit=0`: scrape everything until a page yields no new job id or the `MAX_RESULTS_CEILING` (1000) is reached.
- **Single-job scrape** — `scrapeJob(urlOrId)`: fetch one posting by numeric id, `/jobs/view/<id>` URL, or `?currentJobId=<id>` URL, bypassing search and pagination. The posting is read via the jobs-**search** URL carrying `currentJobId=<id>` (plus a throwaway `keywords`), never the standalone `/jobs/view` page, which serves an obfuscated shell; the emitted `link` is still the canonical `/jobs/view/<id>`. A healthy authenticated session whose detail panel never renders for the id is a **not-found** (`scraper.notFound`); a throttle or lost session is not. Shares the same detail extraction as the search flow.
- **Relative date parsing** — turning LinkedIn's relative posted-date text ("2 weeks ago") into an approximate ISO `YYYY-MM-DD`. `date` is the `<time>` `datetime` attribute when present, else the parsed fallback (week≈7, month≈30, year≈365 days; empty string if unparseable); `dateText` keeps the raw relative text. Ported faithfully from Python's `parse_relative_date`.
- **Location (geo pin)** — a `Location(geoId, name?)` entry in a query's `locations` list, pinning the search deterministically by LinkedIn `geoId` rather than free text. When present it sets the `geoId=` URL param and **omits** `location=` (LinkedIn lets `geoId` win over a name in a conflict). Coexists with plain-string locations in the same `(string | Location)[]` list. Modeled as a thin class for `new Location(...)` ergonomics plus a `label` getter used in per-location log tags; its validity (non-empty `geoId`, string `name`) is checked centrally in `validateQuery`, not by a throwing method on the class.
- **Benefits (two senses)** — the word names two opposite-direction concepts that never collide in code. As a **filter input** (`filters.benefits`, URL param `f_BE`) it is an enum of benefit *categories* you search by. As a **data field** (`IData.benefits`) it is the free-text benefits *scraped off a posting*. Both mirror Python's own naming on their respective sides.

## Python → Node name mapping (parity)

Semantics are ported from Python v7.0.10; names are translated to Node idiom (camelCase fields, `scraper.<name>` events).

### Fields (`EventData` → `IData`)

Node keeps the optional `?` idiom for fields that may be genuinely absent from the DOM (Python instead defaults them to `''`/`[]`); booleans are always determinable and stay required.

| Python (snake_case) | Node (camelCase) | Notes |
|---|---|---|
| `company_employee_count` | `companyEmployeeCount?` (`string`) | new, optional |
| `salary` | `salary?` (`string`) | new, optional — raw text (ranges/`+`/`Over N`), not parsed |
| `is_easy_apply` | `isEasyApply` (`boolean`) | new |
| `applicant_count` | `applicantCount?` (`string`) | new, optional — raw text, not parsed |
| `benefits` | `benefits?` (`string[]`) | new, optional |
| `reposted` | `reposted` (`boolean`) | new — derived from `dateText` containing "reposted" |
| *(removed in Python v7.0.10)* | *(removed in Node too)* | `skills` **dropped for parity** — LinkedIn exposes no skill names in the DOM, only a Premium-gated "N of M skills match" control |

### Events

| Python (`Events.*`) | Node (`scraper.*`) | Notes |
|---|---|---|
| `BEGIN` | `scraper.begin` | new — carries job total |
| `NOT_FOUND` | `scraper.notFound` | new — single-job scrape miss |
| `SESSION_REFRESHED` | `scraper.sessionRefreshed` | new — carries refreshed `li_at` |

### Filters (new)

| Python | Node | URL param |
|---|---|---|
| `job_function` | `jobFunction` | `f_F` |
| `benefits` | `benefits` | `f_BE` |
| `commitments` | `commitments` | `f_JC` |
| `easy_apply` | `easyApply` | `f_AL` |
| `under_10_applicants` | `under10Applicants` | `f_EA` |
| `Location(geo_id)` | `Location(geoId)` | pins search via `geoId` |
