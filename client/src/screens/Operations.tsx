import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Clinic, Expense, Invoice, Product } from '../../../shared/types';
import { EXPENSE_CATEGORIES, INVOICE_STATUSES, PRODUCT_KINDS } from '../../../shared/types';
import { api, ApiError, type ReportsView } from '../api';
import { Dialog, EmptyState, ErrorState } from '../components';
import { BarChart, ChartCard, DonutChart, LineChart } from '../components/Charts';

/**
 * Operations — running the practice, as opposed to treating the patients.
 *
 * Four screens behind a hub: the catalogue, money owed and owing, money spent,
 * and the reports built from all three. Administrator-only, enforced on the
 * server; this file only decides what to draw.
 *
 * Every amount here is an integer number of cents from the moment it leaves an
 * input to the moment it is formatted for display. Nothing multiplies or sums
 * a float — a total that disagrees with its own lines by a cent is how a clinic
 * stops trusting a ledger.
 */

export type OpsScreen = 'hub' | 'forms' | 'products' | 'invoices' | 'expenses' | 'reports';

/* -------------------------------------------------------------- currency -- */

function useMoney(clinic: Clinic | null) {
  const currency = clinic?.currency || 'USD';
  return useMemo(() => {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    });
    return {
      /** Cents to a display string. The only place cents become a decimal. */
      format: (cents: number) => formatter.format(cents / 100),
      /** Compact form for chart axes, where full precision is noise. */
      short: (cents: number) => {
        const units = cents / 100;
        if (Math.abs(units) >= 1000) return `${Math.round(units / 1000)}k`;
        return String(Math.round(units));
      },
    };
  }, [currency]);
}

/**
 * Typed money is a decimal string on screen and an integer in the payload.
 * Parsing at the boundary keeps floats out of everything downstream.
 */
function toCents(input: string): number {
  const n = Number(input.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/* ------------------------------------------------------------------- hub -- */

interface OpsCard {
  screen: OpsScreen;
  title: string;
  blurb: string;
  action: string;
  icon: string;
  /** Money is administrator-only; clinical documents are not. */
  adminOnly: boolean;
}

const CARDS: OpsCard[] = [
  { screen: 'forms', title: 'Generate Forms', blurb: 'Occupational health and medical reports, drafted from the record', action: 'Open forms', icon: '▤', adminOnly: false },
  { screen: 'products', title: 'Product Management', blurb: 'Supplies, services and retail items', action: 'Open products', icon: '◳', adminOnly: true },
  { screen: 'invoices', title: 'Invoice Manager', blurb: 'Patient invoices and vendor bills', action: 'Open invoices', icon: '▦', adminOnly: true },
  { screen: 'expenses', title: 'Expense Management', blurb: 'What the clinic spends, and on what', action: 'Open expenses', icon: '▧', adminOnly: true },
  { screen: 'reports', title: 'Reports & Analytics', blurb: 'How the practice is actually doing', action: 'Open reports', icon: '▥', adminOnly: true },
];

export function OperationsHub({
  onOpen,
  isAdmin,
}: {
  onOpen: (screen: OpsScreen) => void;
  isAdmin: boolean;
}) {
  /*
   * Generating a form is clinical work — a doctor writes and signs it, and the
   * server asks only that they are a clinician. The financial screens are the
   * administrator's. Showing a card that leads to a 403 teaches people to
   * distrust the navigation, so the ones they cannot open are not drawn.
   */
  const visible = CARDS.filter((card) => isAdmin || !card.adminOnly);

  return (
    <div className="stack">
      <div className="page-head">
        <h2>Operations</h2>
        <div className="sub">Running the practice, alongside treating the patients</div>
      </div>
      <div className="ops-grid">
        {visible.map((card) => (
          <button key={card.screen} className="ops-card" onClick={() => onOpen(card.screen)}>
            <span className="ops-icon" aria-hidden="true">{card.icon}</span>
            <span className="ops-title">{card.title}</span>
            <span className="ops-blurb">{card.blurb}</span>
            <span className="ops-action">{card.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- shared -- */

function Pager({
  page,
  totalPages,
  total,
  onPage,
  noun,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (n: number) => void;
  noun: string;
}) {
  if (total === 0) return null;
  return (
    <div className="pager">
      <span className="pager-count tabular">
        {total} {total === 1 ? noun : `${noun}s`}
      </span>
      <span className="row" style={{ gap: 'var(--gap-2)' }}>
        <button className="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="tabular">Page {page} of {totalPages}</span>
        <button className="quiet" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
}

/** A back link plus title, shared by the four sub-screens. */
function OpsHead({ title, sub, onBack, children }: { title: string; sub?: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="spread page-head">
      <div className="row" style={{ gap: 'var(--gap-3)' }}>
        <button className="quiet" onClick={onBack} aria-label="Back to operations">←</button>
        <div>
          <h2>{title}</h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

/** Debounced value, so a search fires once the clinician stops typing. */
function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/* --------------------------------------------------------------- products -- */

export function Products({ clinic, onBack }: { clinic: Clinic | null; onBack: () => void }) {
  const money = useMoney(clinic);
  const [rows, setRows] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [kind, setKind] = useState('supply');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = useDebounced(search);

  const load = useCallback(() => {
    api
      .products({ search: query || undefined, kind, archived, page, pageSize: 10 })
      .then((r) => {
        setRows(r.products);
        setLowStock(r.lowStock);
        setMeta({ total: r.total, page: r.page, totalPages: r.totalPages });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [query, kind, archived, page]);

  useEffect(load, [load]);
  // A narrowed filter can leave the current page past the end of the results.
  useEffect(() => setPage(1), [query, kind, archived]);

  return (
    <div className="stack">
      <OpsHead title="Product Management" sub="Supplies, services and retail items" onBack={onBack}>
        <button className="primary" onClick={() => setAdding(true)}>+ Add product</button>
      </OpsHead>

      {error && <ErrorState message={error} onRetry={load} />}

      {lowStock.length > 0 && (
        <div className="notice">
          <strong>{lowStock.length} {lowStock.length === 1 ? 'item is' : 'items are'} at or below the reorder point.</strong>{' '}
          {lowStock.slice(0, 3).map((p) => `${p.name} (${p.stock})`).join(', ')}
          {lowStock.length > 3 ? ', and more.' : '.'}
        </div>
      )}

      <div className="toolbar row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, SKU, barcode or category"
          aria-label="Search products"
          style={{ flex: 1, minWidth: 220 }}
        />
        <label className="row" style={{ gap: 'var(--gap-2)' }}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="tabs">
        {PRODUCT_KINDS.map((k) => (
          <button
            key={k.value}
            className={`tab ${kind === k.value ? 'active' : ''}`}
            onClick={() => setKind(k.value)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No products here yet." when="Add the first one to start tracking stock and prices." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>SKU / Barcode</th><th>Category</th>
                <th className="right">Price</th><th className="right">Stock</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                // Services have nothing to run out of, so they are never low.
                const low = p.kind !== 'service' && p.reorderPoint > 0 && p.stock <= p.reorderPoint;
                return (
                  <tr key={p.id} className={p.archived ? 'muted-row' : ''}>
                    <td>{p.name}</td>
                    <td className="tabular">{p.sku || '—'}{p.barcode ? ` / ${p.barcode}` : ''}</td>
                    <td>{p.category || '—'}</td>
                    <td className="right tabular">{money.format(p.priceCents)}</td>
                    <td className="right tabular">
                      {p.kind === 'service' ? '—' : p.stock}
                      {low && <span className="chip chip-warn">low</span>}
                    </td>
                    <td>{p.archived ? <span className="chip">Archived</span> : <span className="chip chip-ok">Active</span>}</td>
                    <td className="right">
                      <button
                        className="quiet"
                        onClick={() =>
                          api
                            .updateProduct(p.id, { archived: !p.archived })
                            .then(load)
                            .catch((e: ApiError) => setError(e.message))
                        }
                      >
                        {p.archived ? 'Restore' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="product" />

      {adding && (
        <ProductDialog
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function ProductDialog({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [kind, setKind] = useState<Product['kind']>('supply');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [reorderPoint, setReorderPoint] = useState('0');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createProduct({
        name: name.trim(),
        sku: sku.trim(),
        barcode: barcode.trim(),
        kind,
        category: category.trim(),
        priceCents: toCents(price),
        stock: Number(stock) || 0,
        reorderPoint: Number(reorderPoint) || 0,
      });
      onSaved();
    } catch (e) {
      onError((e as ApiError).message);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a product" onClose={onClose}>
      <div className="stack">
        <div>
          <label htmlFor="p-name">Name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nitrile gloves (box of 100)" />
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="p-kind">Type</label>
            <select id="p-kind" value={kind} onChange={(e) => setKind(e.target.value as Product['kind'])}>
              {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-cat">Category</label>
            <input id="p-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Consumables" />
          </div>
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="p-sku">SKU</label>
            <input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="GLV-100" />
          </div>
          <div>
            <label htmlFor="p-barcode">Barcode</label>
            <input id="p-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="p-price">Price</label>
            <input id="p-price" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="24.50" inputMode="decimal" />
          </div>
          {/* A service has no stock, so the fields that describe stock go away
              rather than sitting there inviting a meaningless number. */}
          {kind !== 'service' && (
            <div>
              <label htmlFor="p-stock">Stock on hand</label>
              <input id="p-stock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
            </div>
          )}
        </div>
        {kind !== 'service' && (
          <div>
            <label htmlFor="p-reorder">Reorder point</label>
            <input id="p-reorder" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} inputMode="numeric" />
            <p className="hint">Reported as low once stock reaches this. Leave at 0 for no warning.</p>
          </div>
        )}
        <div className="row">
          <button className="primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Add product'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------- invoices -- */

export function Invoices({ clinic, onBack }: { clinic: Clinic | null; onBack: () => void }) {
  const money = useMoney(clinic);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState({ outstandingCents: 0, overdueCount: 0, overdueCents: 0, collectedThisMonthCents: 0 });
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useDebounced(search);

  const load = useCallback(() => {
    api
      .invoices({ search: query || undefined, kind: kind || undefined, status: status || undefined, page, pageSize: 10 })
      .then((r) => {
        setRows(r.invoices);
        setSummary(r.summary);
        setMeta({ total: r.total, page: r.page, totalPages: r.totalPages });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [query, kind, status, page]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, kind, status]);

  const setStatusOf = (invoice: Invoice, next: 'sent' | 'paid' | 'void') =>
    api.setInvoiceStatus(invoice.id, next).then(load).catch((e: ApiError) => setError(e.message));

  return (
    <div className="stack">
      <OpsHead title="Invoice Manager" sub="Money owed to the clinic, and money it owes" onBack={onBack}>
        <button className="primary" onClick={() => setCreating(true)}>+ New invoice</button>
      </OpsHead>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="stats">
        <div className="stat">
          <span className="dot" style={{ color: 'var(--brand)' }} />
          <span><span className="n tabular">{money.format(summary.outstandingCents)}</span><span className="k">Outstanding</span></span>
        </div>
        <div className={`stat ${summary.overdueCount > 0 ? 'critical' : ''}`}>
          <span className="dot" />
          <span>
            <span className="n tabular">{money.format(summary.overdueCents)}</span>
            <span className="k">Overdue · {summary.overdueCount}</span>
          </span>
        </div>
        <div className="stat managed">
          <span className="dot" />
          <span><span className="n tabular">{money.format(summary.collectedThisMonthCents)}</span><span className="k">Collected this month</span></span>
        </div>
      </div>

      <div className="toolbar row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, contact or notes"
          aria-label="Search invoices"
          style={{ flex: 1, minWidth: 220 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="tabs">
        {[{ value: '', label: 'All' }, { value: 'patient', label: 'Patient invoices' }, { value: 'vendor', label: 'Vendor bills' }].map((t) => (
          <button key={t.value} className={`tab ${kind === t.value ? 'active' : ''}`} onClick={() => setKind(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices match." when="Raise one from a patient's recorded work, or bill a vendor." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th><th>Type</th><th>Contact</th><th>Issued</th><th>Due</th>
                <th className="right">Amount</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="tabular">{i.number}</td>
                  <td>{i.kind === 'patient' ? 'Patient' : 'Vendor'}</td>
                  <td>{i.contactName}</td>
                  <td className="tabular">{i.issuedOn}</td>
                  <td className="tabular">{i.dueOn}</td>
                  <td className="right tabular">{money.format(i.amountCents)}</td>
                  <td>
                    {/* Overdue is derived from the due date, so it wins over the
                        stored status — an invoice sent and now late reads as
                        overdue without anything having to update it. */}
                    {i.overdue
                      ? <span className="chip chip-crit">Overdue</span>
                      : <span className={`chip ${i.status === 'paid' ? 'chip-ok' : ''}`}>{i.status}</span>}
                  </td>
                  <td className="right">
                    <span className="row" style={{ gap: 'var(--gap-2)', justifyContent: 'flex-end' }}>
                      {i.status === 'draft' && <button className="quiet" onClick={() => setStatusOf(i, 'sent')}>Send</button>}
                      {i.status === 'sent' && <button className="quiet" onClick={() => setStatusOf(i, 'paid')}>Mark paid</button>}
                      {i.status !== 'void' && <button className="quiet" onClick={() => setStatusOf(i, 'void')}>Void</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="invoice" />

      {creating && (
        <InvoiceDialog
          money={money}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

interface Line { description: string; quantity: number; unitPriceCents: number; billingEntryId?: string | null }

function InvoiceDialog({
  money,
  onClose,
  onSaved,
  onError,
}: {
  money: { format: (c: number) => string };
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<'patient' | 'vendor'>('patient');
  const [contactName, setContactName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patients, setPatients] = useState<Array<{ id: string; name: string }>>([]);
  const [billable, setBillable] = useState<Array<{ id: string; code: string; description: string }>>([]);
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitPriceCents: 0 }]);
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.patients({ pageSize: 100 }).then((r) => setPatients(r.patients.map((p) => ({ id: p.id, name: p.name })))).catch(() => setPatients([]));
  }, []);

  // The clinical side already recorded what was done. Retyping it into an
  // invoice is how a line ends up describing something the record does not.
  useEffect(() => {
    if (!patientId) { setBillable([]); return; }
    api.billable(patientId).then((r) => setBillable(r.entries)).catch(() => setBillable([]));
  }, [patientId]);

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
  const patch = (index: number, next: Partial<Line>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...next } : l)));

  const save = async () => {
    const usable = lines.filter((l) => l.description.trim());
    if (!contactName.trim() || usable.length === 0) return;
    setBusy(true);
    try {
      await api.createInvoice({
        kind,
        contactName: contactName.trim(),
        patientId: kind === 'patient' ? patientId || null : null,
        dueOn: dueOn || undefined,
        status: 'draft',
        lines: usable,
      });
      onSaved();
    } catch (e) {
      onError((e as ApiError).message);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New invoice" onClose={onClose}>
      <div className="stack">
        <div className="field-pair">
          <div>
            <label htmlFor="i-kind">Type</label>
            <select id="i-kind" value={kind} onChange={(e) => setKind(e.target.value as 'patient' | 'vendor')}>
              <option value="patient">Patient invoice</option>
              <option value="vendor">Vendor bill</option>
            </select>
          </div>
          <div>
            <label htmlFor="i-due">Due</label>
            <input id="i-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
        </div>

        {kind === 'patient' ? (
          <div>
            <label htmlFor="i-patient">Patient</label>
            <select
              id="i-patient"
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value);
                setContactName(patients.find((p) => p.id === e.target.value)?.name ?? '');
              }}
            >
              <option value="">Choose a patient…</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="i-contact">Vendor</label>
            <input id="i-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="District Laboratory" />
          </div>
        )}

        {billable.length > 0 && (
          <div className="notice">
            <strong>{billable.length} recorded {billable.length === 1 ? 'item' : 'items'} not yet invoiced.</strong>
            <div className="row" style={{ marginTop: 'var(--gap-2)', flexWrap: 'wrap' }}>
              {billable.map((b) => (
                <button
                  key={b.id}
                  className="quiet"
                  onClick={() =>
                    setLines((current) => [
                      ...current.filter((l) => l.description.trim()),
                      { description: b.description, quantity: 1, unitPriceCents: 0, billingEntryId: b.id },
                    ])
                  }
                >
                  + {b.code}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label>Lines</label>
          {lines.map((line, index) => (
            <div key={index} className="row line-row">
              <input
                value={line.description}
                onChange={(e) => patch(index, { description: e.target.value })}
                placeholder="What is being billed"
                style={{ flex: 1, minWidth: 160 }}
                aria-label={`Line ${index + 1} description`}
              />
              <input
                value={String(line.quantity)}
                onChange={(e) => patch(index, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                inputMode="numeric" style={{ width: 70 }} aria-label={`Line ${index + 1} quantity`}
              />
              <input
                defaultValue=""
                onChange={(e) => patch(index, { unitPriceCents: toCents(e.target.value) })}
                placeholder="0.00" inputMode="decimal" style={{ width: 110 }} aria-label={`Line ${index + 1} unit price`}
              />
              <span className="tabular line-total">{money.format(line.quantity * line.unitPriceCents)}</span>
            </div>
          ))}
          <button className="quiet" onClick={() => setLines((c) => [...c, { description: '', quantity: 1, unitPriceCents: 0 }])}>
            + Add line
          </button>
        </div>

        {/* The total is the sum of the lines and is never typed. A header that
            disagrees with its own detail is the classic ledger bug. */}
        <div className="spread invoice-total">
          <strong>Total</strong>
          <strong className="tabular">{money.format(total)}</strong>
        </div>

        <div className="row">
          <button className="primary" onClick={save} disabled={busy || !contactName.trim()}>
            {busy ? 'Saving…' : 'Create invoice'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------- expenses -- */

export function Expenses({ clinic, onBack }: { clinic: Clinic | null; onBack: () => void }) {
  const money = useMoney(clinic);
  const [rows, setRows] = useState<Expense[]>([]);
  const [summary, setSummary] = useState({ thisMonthCents: 0, thisMonthCount: 0, thisYearCents: 0, totalCount: 0 });
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = useDebounced(search);

  const load = useCallback(() => {
    api
      .expenses({ search: query || undefined, category: category || undefined, page, pageSize: 10 })
      .then((r) => {
        setRows(r.expenses);
        setSummary(r.summary);
        setMeta({ total: r.total, page: r.page, totalPages: r.totalPages });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [query, category, page]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, category]);

  const label = (value: string) => EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;

  return (
    <div className="stack">
      <OpsHead title="Expense Management" sub="Track and manage what the clinic spends" onBack={onBack}>
        <button className="primary" onClick={() => setAdding(true)}>+ Add expense</button>
      </OpsHead>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="stats">
        <div className="stat">
          <span className="dot" style={{ color: 'var(--brand)' }} />
          <span>
            <span className="n tabular">{money.format(summary.thisMonthCents)}</span>
            <span className="k">This month · {summary.thisMonthCount}</span>
          </span>
        </div>
        <div className="stat watch">
          <span className="dot" />
          <span><span className="n tabular">{money.format(summary.thisYearCents)}</span><span className="k">This year</span></span>
        </div>
        <div className="stat stable">
          <span className="dot" />
          <span><span className="n tabular">{summary.totalCount}</span><span className="k">Entries recorded</span></span>
        </div>
      </div>

      <div className="toolbar row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, reference or category"
          aria-label="Search expenses"
          style={{ flex: 1, minWidth: 220 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No expenses recorded." when="Add the first one to start tracking what the clinic spends." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th>Reference</th><th className="right">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="tabular">{e.incurredOn}</td>
                  <td>{e.description}</td>
                  <td><span className="chip">{label(e.category)}</span></td>
                  <td className="tabular">{e.reference || '—'}</td>
                  <td className="right tabular">{money.format(e.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="expense" />

      {adding && (
        <ExpenseDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} onError={setError} />
      )}
    </div>
  );
}

function ExpenseDialog({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Expense['category']>('supplies');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!description.trim()) return;
    setBusy(true);
    try {
      await api.createExpense({
        description: description.trim(),
        category,
        reference: reference.trim(),
        amountCents: toCents(amount),
        incurredOn,
      });
      onSaved();
    } catch (e) {
      onError((e as ApiError).message);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add an expense" onClose={onClose}>
      <div className="stack">
        <div>
          <label htmlFor="e-desc">What was it for</label>
          <input id="e-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Gloves and consumables restock" />
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="e-cat">Category</label>
            <select id="e-cat" value={category} onChange={(e) => setCategory(e.target.value as Expense['category'])}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="e-date">Date</label>
            <input id="e-date" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
          </div>
        </div>
        <div className="field-pair">
          <div>
            <label htmlFor="e-amount">Amount</label>
            <input id="e-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="189.00" inputMode="decimal" />
          </div>
          <div>
            <label htmlFor="e-ref">Reference</label>
            <input id="e-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RCT-3312" />
          </div>
        </div>
        <div className="row">
          <button className="primary" onClick={save} disabled={busy || !description.trim()}>
            {busy ? 'Saving…' : 'Add expense'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- reports -- */

const PERIODS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'all_time', label: 'All time' },
];

type ReportTab = 'financial' | 'operational' | 'clinical';

export function Reports({ clinic, onBack }: { clinic: Clinic | null; onBack: () => void }) {
  const money = useMoney(clinic);
  const [period, setPeriod] = useState('this_month');
  const [tab, setTab] = useState<ReportTab>('financial');
  const [view, setView] = useState<ReportsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.reports(period).then((r) => { setView(r); setError(null); }).catch((e: ApiError) => setError(e.message));
  }, [period]);
  useEffect(load, [load]);

  /** Everything on screen, as CSV, for the clinic's own records. */
  const exportCsv = () => {
    if (!view) return;
    const rows: string[][] = [
      ['Report', view.range.label, `${view.range.from} to ${view.range.to}`],
      [],
      ['Revenue', String(view.headline.revenueCents / 100)],
      ['Collected ratio', `${Math.round(view.headline.collectedRatio * 100)}%`],
      ['Encounters', String(view.headline.encounters)],
      ['Active patients', String(view.headline.activePatients)],
      [],
      ['Month', 'Revenue'],
      ...view.revenueTrend.map((p) => [p.month, String(p.cents / 100)]),
      [],
      ['Expense category', 'Amount'],
      ...view.expenseBreakdown.map((e) => [e.category, String(e.cents / 100)]),
    ];
    // Quoting every field is simpler than deciding which need it, and a
    // description containing a comma is otherwise a silently broken row.
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `medvoice-report-${view.range.from}-to-${view.range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!view) return <div className="card">Loading reports…</div>;

  const h = view.headline;
  const percent = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="stack">
      <OpsHead title="Reports & Analytics" sub={`${view.range.from} to ${view.range.to}`} onBack={onBack}>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Reporting period">
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button className="quiet" onClick={exportCsv}>Export CSV</button>
      </OpsHead>

      <div className="stats">
        <div className="stat">
          <span className="dot" style={{ color: 'var(--brand)' }} />
          <span>
            <span className="n tabular">{money.format(h.revenueCents)}</span>
            <span className="k">Revenue · {percent(h.collectedRatio)} collected</span>
          </span>
        </div>
        <div className="stat stable">
          <span className="dot" />
          <span><span className="n tabular">{h.activePatients}</span><span className="k">Patients · +{h.newPatients} new</span></span>
        </div>
        <div className="stat managed">
          <span className="dot" />
          <span><span className="n tabular">{h.encounters}</span><span className="k">Encounters</span></span>
        </div>
        <div className="stat watch">
          <span className="dot" />
          <span><span className="n tabular">{percent(h.taskCompletion)}</span><span className="k">Gaps closed</span></span>
        </div>
      </div>

      <div className="tabs">
        {(['financial', 'operational', 'clinical'] as ReportTab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'financial' && (
        <div className="report-grid">
          <ChartCard title="Revenue trend">
            <LineChart
              points={view.revenueTrend.map((p) => ({ label: p.month.slice(2), value: p.cents }))}
              format={money.short}
            />
          </ChartCard>
          <ChartCard title="Expense breakdown">
            <DonutChart
              slices={view.expenseBreakdown.map((e) => ({
                label: EXPENSE_CATEGORIES.find((c) => c.value === e.category)?.label ?? e.category,
                value: e.cents,
              }))}
              total={money.short(view.expenseBreakdown.reduce((a, e) => a + e.cents, 0))}
              centreLabel="total"
            />
          </ChartCard>
          <ChartCard title="Collections vs outstanding">
            <BarChart
              bars={[
                { label: 'Collected', value: view.collections.collectedCents },
                { label: 'Outstanding', value: view.collections.outstandingCents },
              ]}
              format={money.format}
            />
          </ChartCard>
          <ChartCard title="Top services by revenue">
            <BarChart
              bars={view.topServices.map((t) => ({ label: t.description, value: t.cents }))}
              format={money.format}
            />
          </ChartCard>
        </div>
      )}

      {tab === 'operational' && (
        <div className="report-grid">
          <ChartCard title="Work in progress">
            <BarChart
              bars={[
                { label: 'Orders outstanding', value: view.operational.ordersOutstanding },
                { label: 'Orders completed', value: view.operational.ordersCompleted },
                { label: 'Items low on stock', value: view.operational.lowStock },
              ]}
              format={(n) => String(n)}
            />
          </ChartCard>
          <ChartCard title="Recorded but not invoiced">
            {/* The one number here a generic ledger cannot produce: clinical
                work the record already knows about that has never been billed. */}
            <div className="big-number">
              <span className="n tabular">{view.operational.unbilledEntries}</span>
              <p className="hint">
                Billing entries created by clinical work that no invoice line refers to. Each one is
                work the clinic has done and not charged for.
              </p>
            </div>
          </ChartCard>
        </div>
      )}

      {tab === 'clinical' && (
        <div className="report-grid">
          <ChartCard title="Active flags by urgency">
            <BarChart
              bars={Object.entries(view.clinical.byUrgency).map(([k, v]) => ({ label: k, value: v }))}
              format={(n) => String(n)}
            />
          </ChartCard>
          <ChartCard title="Documentation">
            <BarChart
              bars={[
                { label: 'Flags raised in period', value: view.clinical.flagsRaised },
                { label: 'Flags resolved', value: view.clinical.flagsResolved },
                { label: 'Gaps still open', value: view.clinical.gapsOpen },
              ]}
              format={(n) => String(n)}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
