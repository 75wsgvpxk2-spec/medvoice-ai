import { db } from '../db/index.ts';
import { invoices, expenses } from '../db/repositories.ts';

/**
 * Reports and analytics — the practice, not the patients.
 *
 * Every figure here is computed in SQL over the period asked for, rather than
 * accumulated into a totals row somewhere. A stored total is a second copy of
 * the truth, and the two drift the first time a record is voided.
 *
 * Money is in integer cents throughout, formatted once by the client against
 * the clinic's configured currency.
 */

export type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time';

export interface Range {
  from: string;
  to: string;
  label: string;
}

/** Resolve a named period into inclusive ISO date bounds. */
export function rangeFor(period: Period, asOf = new Date()): Range {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const first = (yy: number, mm: number): Date => new Date(Date.UTC(yy, mm, 1));
  // Day 0 of the next month is the last day of this one, which avoids having to
  // know which months have 31 days or whether this is a leap year.
  const last = (yy: number, mm: number): Date => new Date(Date.UTC(yy, mm + 1, 0));

  switch (period) {
    case 'last_month':
      return { from: iso(first(y, m - 1)), to: iso(last(y, m - 1)), label: 'Last month' };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(first(y, q)), to: iso(last(y, q + 2)), label: 'This quarter' };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: 'This year' };
    case 'all_time':
      return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
    default:
      return { from: iso(first(y, m)), to: iso(last(y, m)), label: 'This month' };
  }
}

export interface ReportsView {
  range: Range;
  headline: {
    revenueCents: number;
    collectedRatio: number;
    activePatients: number;
    newPatients: number;
    encounters: number;
    /** Documentation gaps closed as a share of those raised in the period. */
    taskCompletion: number;
  };
  revenueTrend: Array<{ month: string; cents: number }>;
  expenseBreakdown: Array<{ category: string; cents: number }>;
  collections: { collectedCents: number; outstandingCents: number };
  topServices: Array<{ description: string; cents: number }>;
  operational: {
    ordersOutstanding: number;
    ordersCompleted: number;
    lowStock: number;
    /** Billing entries still in draft — work done and not yet invoiced. */
    unbilledEntries: number;
  };
  clinical: {
    flagsRaised: number;
    flagsResolved: number;
    gapsOpen: number;
    byUrgency: Record<string, number>;
  };
}

export function buildReports(period: Period): ReportsView {
  const range = rangeFor(period);
  const conn = db();
  const one = (sql: string, ...args: unknown[]): number => {
    const row = conn.prepare(sql).get(...args) as Record<string, unknown> | undefined;
    return Number(row?.['n'] ?? 0);
  };

  const revenueCents = one(
    "SELECT COALESCE(SUM(amount_cents),0) AS n FROM invoice WHERE kind='patient' AND status IN ('sent','paid') AND issued_on BETWEEN ? AND ?",
    range.from, range.to,
  );
  const collectedCents = one(
    "SELECT COALESCE(SUM(amount_cents),0) AS n FROM invoice WHERE kind='patient' AND status='paid' AND paid_on BETWEEN ? AND ?",
    range.from, range.to,
  );
  const outstandingCents = one(
    "SELECT COALESCE(SUM(amount_cents),0) AS n FROM invoice WHERE kind='patient' AND status='sent' AND issued_on BETWEEN ? AND ?",
    range.from, range.to,
  );

  const encounters = one(
    "SELECT COUNT(*) AS n FROM encounter WHERE status='approved' AND date BETWEEN ? AND ?",
    range.from, range.to,
  );
  const gapsRaised = one(
    'SELECT COUNT(*) AS n FROM documentation_alert WHERE substr(created_at,1,10) BETWEEN ? AND ?',
    range.from, range.to,
  );
  const gapsClosed = one(
    "SELECT COUNT(*) AS n FROM documentation_alert WHERE status='resolved' AND substr(resolved_at,1,10) BETWEEN ? AND ?",
    range.from, range.to,
  );

  const rows = <T>(sql: string, ...args: unknown[]): T[] => conn.prepare(sql).all(...args) as T[];

  return {
    range,
    headline: {
      revenueCents,
      collectedRatio: revenueCents > 0 ? collectedCents / revenueCents : 0,
      activePatients: one('SELECT COUNT(*) AS n FROM patient'),
      newPatients: one(
        // Single quotes: SQLite reads a double-quoted token as an identifier,
        // so "" is a column name that does not exist rather than empty text.
        "SELECT COUNT(*) AS n FROM patient WHERE substr(COALESCE(created_at, ''),1,10) BETWEEN ? AND ?",
        range.from, range.to,
      ),
      encounters,
      taskCompletion: gapsRaised > 0 ? gapsClosed / gapsRaised : 0,
    },

    // Twelve months back from the end of the range, so a trend line always has
    // shape even when the selected period is a single month.
    revenueTrend: rows<{ month: string; cents: number }>(
      `SELECT substr(issued_on,1,7) AS month, COALESCE(SUM(amount_cents),0) AS cents
         FROM invoice
        WHERE kind='patient' AND status IN ('sent','paid') AND issued_on <= ?
        GROUP BY month ORDER BY month DESC LIMIT 12`,
      range.to,
    ).reverse(),

    expenseBreakdown: rows<{ category: string; cents: number }>(
      `SELECT category, COALESCE(SUM(amount_cents),0) AS cents
         FROM expense WHERE incurred_on BETWEEN ? AND ?
        GROUP BY category ORDER BY cents DESC`,
      range.from, range.to,
    ),

    collections: { collectedCents, outstandingCents },

    topServices: rows<{ description: string; cents: number }>(
      `SELECT l.description AS description,
              COALESCE(SUM(l.quantity * l.unit_price_cents),0) AS cents
         FROM invoice_line l
         JOIN invoice i ON i.id = l.invoice_id
        WHERE i.kind='patient' AND i.status IN ('sent','paid') AND i.issued_on BETWEEN ? AND ?
        GROUP BY l.description ORDER BY cents DESC LIMIT 5`,
      range.from, range.to,
    ),

    operational: {
      ordersOutstanding: one("SELECT COUNT(*) AS n FROM \"order\" WHERE status='requested'"),
      ordersCompleted: one(
        "SELECT COUNT(*) AS n FROM \"order\" WHERE status='completed' AND substr(completed_at,1,10) BETWEEN ? AND ?",
        range.from, range.to,
      ),
      lowStock: one(
        "SELECT COUNT(*) AS n FROM product WHERE archived=0 AND kind<>'service' AND reorder_point>0 AND stock<=reorder_point",
      ),
      // Clinical work recorded but never turned into an invoice. The clearest
      // operational number this system can produce that a generic ledger cannot.
      unbilledEntries: one(
        `SELECT COUNT(*) AS n FROM billing_entry b
          WHERE NOT EXISTS (SELECT 1 FROM invoice_line l WHERE l.billing_entry_id = b.id)`,
      ),
    },

    clinical: {
      flagsRaised: one(
        'SELECT COUNT(*) AS n FROM risk_flag WHERE substr(created_at,1,10) BETWEEN ? AND ?',
        range.from, range.to,
      ),
      flagsResolved: one("SELECT COUNT(*) AS n FROM risk_flag WHERE status <> 'active'"),
      gapsOpen: one("SELECT COUNT(*) AS n FROM documentation_alert WHERE status='open'"),
      byUrgency: Object.fromEntries(
        rows<{ urgency: string; n: number }>(
          "SELECT urgency, COUNT(*) AS n FROM risk_flag WHERE status='active' GROUP BY urgency",
        ).map((r) => [r.urgency, r.n]),
      ),
    },
  };
}

/** Re-exported so the route can answer the KPI cards without a second import. */
export const summaries = { invoices, expenses };
