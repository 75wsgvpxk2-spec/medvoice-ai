/**
 * Paging, in one place, because every list screen has to behave the same way.
 *
 * The rule these helpers exist to enforce: **filter and sort the whole set
 * first, then take a page from the result.** Doing it the other way round —
 * paging first, then searching what came back — produces search that works
 * perfectly until the list outgrows one page, and then quietly reports "no
 * matches" for a row that is sitting on page three. The run log shipped with
 * exactly that bug behind a 200-row ceiling.
 *
 * `takePage` can only be given an array that has already been narrowed, which
 * is the point: the ordering is structural rather than a convention each route
 * has to remember.
 */

/** What a paged endpoint reports back, alongside its own rows. */
export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PageOf<T> extends PageMeta {
  items: T[];
}

/** Below this a pager is more chrome than list; above it the page is a scroll. */
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;

/**
 * A whole number of at least one, or the fallback.
 *
 * Query values are whatever someone put in the URL, so zero, a negative, a
 * fraction, an empty string, an array and `abc` all have to land somewhere
 * sensible before they reach a LIMIT clause.
 */
function whole(value: unknown, fallback: number): number {
  // A repeated query parameter arrives as an array, and `Number(['2'])` is 2 —
  // so the shape is checked rather than left to coercion to be surprising.
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Read `page` and `pageSize` from a query string, refusing anything absurd.
 *
 * One rule, so the behaviour is easy to state: a value that is not a usable
 * number is treated as if it were absent, and a usable one is clamped into
 * range. The ceiling stops `?pageSize=100000` being a way to pull the whole
 * population in a single request.
 */
export function readPaging(
  query: Record<string, unknown>,
  defaultPageSize: number,
): { page: number; pageSize: number } {
  const requested = whole(query['pageSize'], defaultPageSize);
  return {
    page: whole(query['page'], 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, requested)),
  };
}

/**
 * Describe a page of a set counted elsewhere — the SQL case, where the database
 * has done the counting and slicing and only the arithmetic is shared.
 */
export function pageMeta(total: number, page: number, pageSize: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { total, page: Math.min(page, totalPages), pageSize, totalPages };
}

/**
 * Take one page from an already filtered and sorted list.
 *
 * The page is clamped to the last one that exists. Without that, narrowing a
 * search while on page four leaves the clinician looking at an empty list with
 * working Previous/Next buttons and no indication of what happened.
 */
export function takePage<T>(rows: readonly T[], page: number, pageSize: number): PageOf<T> {
  const meta = pageMeta(rows.length, page, pageSize);
  const start = (meta.page - 1) * meta.pageSize;
  return { ...meta, items: rows.slice(start, start + meta.pageSize) };
}
