import { useCallback, useEffect, useState } from 'react';
import type { AuditEvent, Patient } from '../../../shared/types';
import { api, type DashboardView, type ThresholdRow } from '../api';

/**
 * Everything the room's surfaces show, fetched once for the whole room.
 *
 * Nine panels are visible at the same time, and nine independent hooks would
 * mean nine requests on mount and nine more every time an agent finishes. This
 * gathers them into one pass and refreshes on the same signal the queue does,
 * so the wall and the room stay in step.
 *
 * A panel whose request fails shows nothing rather than something wrong. That
 * is the reason each slice keeps its own null: a stale count on a clinical
 * surface is worse than an empty one.
 */
export interface RoomData {
  dashboard: DashboardView | null;
  patients: Patient[];
  patientTotal: number;
  thresholds: ThresholdRow[];
  audit: AuditEvent[];
  /** What the operations monitor puts on its screen. */
  operations: {
    products: number;
    invoices: number;
    unpaidInvoices: number;
    expenses: number;
    forms: number;
  } | null;
  loading: boolean;
}

const EMPTY: RoomData = {
  dashboard: null,
  patients: [],
  patientTotal: 0,
  thresholds: [],
  audit: [],
  operations: null,
  loading: true,
};

export function useRoomData(refreshKey: number): RoomData {
  const [data, setData] = useState<RoomData>(EMPTY);

  const load = useCallback(async (alive: () => boolean) => {
    /*
     * The operations counts are asked for with a page size of one: the monitor
     * shows totals, and pulling every invoice in the clinic to count them is
     * work the server has already done in the `total` field.
     */
    const [dashboard, patients, thresholds, audit, products, invoices, unpaid, expenses, forms] =
      await Promise.all([
        api.dashboard().catch(() => null),
        api.patients({ pageSize: 40 }).catch(() => null),
        api.thresholds().catch(() => null),
        api.audit({ page: 1 }).catch(() => null),
        api.products({ pageSize: 1 }).catch(() => null),
        api.invoices({ pageSize: 1 }).catch(() => null),
        api.invoices({ pageSize: 1, status: 'sent' }).catch(() => null),
        api.expenses({ pageSize: 1 }).catch(() => null),
        api.hseReports({ pageSize: 1 }).catch(() => null),
      ]);

    if (!alive()) return;

    setData({
      dashboard,
      patients: patients?.patients ?? [],
      patientTotal: patients?.total ?? 0,
      thresholds: thresholds?.thresholds ?? [],
      audit: (audit?.events ?? []).slice(0, 6),
      operations:
        products || invoices || expenses
          ? {
              products: products?.total ?? 0,
              invoices: invoices?.total ?? 0,
              unpaidInvoices: unpaid?.total ?? 0,
              expenses: expenses?.total ?? 0,
              forms: forms?.total ?? 0,
            }
          : null,
      loading: false,
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load, refreshKey]);

  return data;
}
