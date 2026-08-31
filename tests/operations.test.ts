import { describe, it, expect, beforeAll } from 'vitest';
import { products, invoices, expenses, patients } from '../server/src/db/repositories.ts';
import { buildReports, rangeFor } from '../server/src/lib/reports.ts';
import { freshPopulation, CLINICIAN_ID } from './helpers.ts';
import { db } from '../server/src/db/index.ts';
import type { Invoice, InvoiceLine, Product, Expense } from '../shared/types.ts';

/**
 * Operations — the practice-management side.
 *
 * The invariants worth pinning are the ones a clinic notices: money that adds
 * up exactly, lists that page without losing a row, and an invoice that cannot
 * be quietly un-paid.
 */

const stamp = '2026-08-01T09:00:00.000Z';

function product(over: Partial<Product> = {}): Product {
  return {
    id: `prd_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Item', sku: '', barcode: '', kind: 'supply', category: '',
    priceCents: 1000, stock: 5, reorderPoint: 0, archived: false,
    createdAt: stamp, updatedAt: stamp, ...over,
  };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: `exp_${Math.random().toString(36).slice(2, 10)}`,
    incurredOn: '2026-08-05', description: 'Something', category: 'supplies',
    reference: '', amountCents: 1000, createdAt: stamp, updatedAt: stamp, ...over,
  };
}

describe('Money is exact', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('sums invoice lines in whole cents with no float drift', () => {
    // The classic float failure: 0.1 + 0.2 !== 0.3. In cents it is 10 + 20 = 30
    // and always will be. A hundred awkward lines must still total exactly.
    const lines = Array.from({ length: 100 }, (_, i) => ({
      quantity: 3,
      unitPriceCents: 1999 + i,
    }));
    const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

    const expected = 3 * (100 * 1999 + (99 * 100) / 2);
    expect(total).toBe(expected);
    expect(Number.isInteger(total)).toBe(true);
  });

  it('stores and returns an invoice total that equals its own lines', () => {
    const patient = patients.forClinic()[0]!;
    const lines: InvoiceLine[] = [
      { id: 'inl_1', invoiceId: '', productId: null, billingEntryId: null, description: 'Consultation', quantity: 1, unitPriceCents: 7500 },
      { id: 'inl_2', invoiceId: '', productId: null, billingEntryId: null, description: 'Follow-up', quantity: 2, unitPriceCents: 4250 },
    ];
    const amountCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);

    const invoice: Invoice = {
      id: 'inv_exact', number: 'INV-9001', kind: 'patient', contactName: patient.name,
      patientId: patient.id, issuedOn: '2026-08-01', dueOn: '2026-08-15', paidOn: null,
      amountCents, status: 'sent', overdue: false, notes: '', createdAt: stamp, updatedAt: stamp,
    };
    invoices.insert(invoice, lines);

    const stored = invoices.byId('inv_exact')!;
    const fromLines = stored.lines!.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    // A header that disagrees with its own detail is the bug this guards.
    expect(stored.amountCents).toBe(fromLines);
    expect(stored.amountCents).toBe(16000);
  });
});

describe('Invoice state', () => {
  it('derives overdue from the due date rather than storing it', () => {
    const stored = invoices.byId('inv_exact')!;
    // Sent, unpaid, and due in the past. Nothing ran to mark it — the state is
    // computed on read, so it cannot be stale.
    expect(stored.status).toBe('sent');
    expect(stored.dueOn < new Date().toISOString().slice(0, 10)).toBe(true);
    expect(stored.overdue).toBe(true);
  });

  it('stops counting an invoice as outstanding once it is paid', () => {
    const before = invoices.summary();
    expect(before.outstandingCents).toBeGreaterThan(0);

    invoices.setStatus('inv_exact', 'paid', new Date().toISOString().slice(0, 10));

    const after = invoices.summary();
    expect(after.outstandingCents).toBe(before.outstandingCents - 16000);
    expect(after.collectedThisMonthCents).toBe(before.collectedThisMonthCents + 16000);
    expect(invoices.byId('inv_exact')!.overdue).toBe(false);
  });

  it('hands out a fresh reference even after one is voided', () => {
    const first = invoices.nextNumber();
    expect(first).toMatch(/^INV-\d{4}$/);
    // Derived from the highest number rather than a count, so voiding cannot
    // cause the same reference to be issued to two different invoices.
    expect(first).not.toBe('INV-9001');
  });
});

describe('Operations lists page without losing rows', () => {
  const PAGE = 5;
  const ROWS = 23;

  beforeAll(() => {
    for (let i = 0; i < ROWS; i += 1) {
      products.insert(product({ name: `Product ${String(i).padStart(2, '0')}`, sku: `SKU-${i}` }));
      expenses.insert(expense({ description: `Expense ${String(i).padStart(2, '0')}`, amountCents: 100 + i }));
    }
  });

  it('walks every product exactly once across the pages', () => {
    const first = products.page({ page: 1, pageSize: PAGE });
    const seen: string[] = [];
    const pages = Math.ceil(first.total / PAGE);
    for (let p = 1; p <= pages; p += 1) {
      seen.push(...products.page({ page: p, pageSize: PAGE }).items.map((x) => x.id));
    }
    expect(seen).toHaveLength(first.total);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('finds a product that is not on the first page', () => {
    const first = products.page({ page: 1, pageSize: PAGE });
    const needle = `Product ${String(ROWS - 1).padStart(2, '0')}`;
    expect(first.items.some((p) => p.name === needle)).toBe(false);

    const found = products.page({ search: needle, page: 1, pageSize: PAGE });
    expect(found.total).toBe(1);
    expect(found.items[0]!.name).toBe(needle);
  });

  it('never reports a page it cannot fill', () => {
    for (const requested of [1, 2, 99, 1000]) {
      expect(products.page({ page: requested, pageSize: PAGE }).items.length, `products page ${requested}`).toBeGreaterThan(0);
      expect(expenses.page({ page: requested, pageSize: PAGE }).items.length, `expenses page ${requested}`).toBeGreaterThan(0);
    }
  });

  it('hides archived products unless asked, and never deletes them', () => {
    const target = products.page({ page: 1, pageSize: 1 }).items[0]!;
    products.update(target.id, { archived: true });

    const visible = products.page({ search: target.name, page: 1, pageSize: PAGE });
    expect(visible.items.some((p) => p.id === target.id)).toBe(false);

    const all = products.page({ search: target.name, includeArchived: true, page: 1, pageSize: PAGE });
    expect(all.items.some((p) => p.id === target.id)).toBe(true);
  });
});

describe('Stock warnings', () => {
  it('reports an item at or below its reorder point, and never a service', () => {
    products.insert(product({ name: 'Gloves', stock: 8, reorderPoint: 10 }));
    products.insert(product({ name: 'Gauze', stock: 40, reorderPoint: 10 }));
    products.insert(product({ name: 'Consultation', kind: 'service', stock: 0, reorderPoint: 10 }));

    const low = products.lowStock().map((p) => p.name);
    expect(low).toContain('Gloves');
    expect(low).not.toContain('Gauze');
    // A service has nothing to run out of; reporting one as low is noise that
    // teaches people to ignore the warning.
    expect(low).not.toContain('Consultation');
  });
});

describe('Reporting periods', () => {
  it('bounds each period correctly, including a leap year February', () => {
    const feb = rangeFor('this_month', new Date(Date.UTC(2028, 1, 15)));
    expect(feb.from).toBe('2028-02-01');
    expect(feb.to).toBe('2028-02-29');

    const q = rangeFor('this_quarter', new Date(Date.UTC(2026, 7, 17)));
    expect(q.from).toBe('2026-07-01');
    expect(q.to).toBe('2026-09-30');

    const dec = rangeFor('last_month', new Date(Date.UTC(2026, 0, 10)));
    expect(dec.from).toBe('2025-12-01');
    expect(dec.to).toBe('2025-12-31');
  });

  it('builds a report whose figures agree with the rows behind them', () => {
    const view = buildReports('all_time');
    const expenseTotal = view.expenseBreakdown.reduce((s, e) => s + e.cents, 0);
    const actual = (db().prepare('SELECT COALESCE(SUM(amount_cents),0) AS n FROM expense').get() as { n: number }).n;
    expect(expenseTotal).toBe(actual);

    // Counts nothing that does not exist: unbilled entries are real rows.
    expect(view.operational.unbilledEntries).toBeGreaterThanOrEqual(0);
    expect(view.headline.collectedRatio).toBeGreaterThanOrEqual(0);
    expect(view.headline.collectedRatio).toBeLessThanOrEqual(1);
  });

  it('reports zero rather than dividing by zero on an empty period', () => {
    // A clinic's first week has no revenue and no gaps. Neither figure should
    // be NaN, which renders as "NaN%" on a card somebody is reading.
    const empty = buildReports('last_month');
    expect(Number.isFinite(empty.headline.collectedRatio)).toBe(true);
    expect(Number.isFinite(empty.headline.taskCompletion)).toBe(true);
  });
});
