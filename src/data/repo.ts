import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { nowIso, toMs } from '../lib/dates';
import {
  ValidationError,
  validateContextEntry,
  validateMeasurement,
  validateSession,
  type ContextEntry,
  type Measurement,
  type MeasurementType,
  type Session,
  type ValidationResult,
} from './schema';

// The only module that touches IndexedDB. Components and features go through this API.

export interface TimeRange {
  start?: string; // inclusive, ISO
  end?: string; // inclusive, ISO
}

interface AyuDB extends DBSchema {
  measurements: { key: string; value: Measurement; indexes: { timestamp: string; type: string } };
  context: { key: string; value: ContextEntry; indexes: { timestamp: string } };
  sessions: { key: string; value: Session; indexes: { timestamp: string; kind: string } };
}

const DB_VERSION = 1;
const STORES = ['measurements', 'context', 'sessions'] as const;

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function assertValid(r: ValidationResult) {
  if (!r.ok) throw new ValidationError(r.errors);
}

function inRange(timestamp: string, range?: TimeRange): boolean {
  if (!range) return true;
  const t = toMs(timestamp);
  if (range.start && t < toMs(range.start)) return false;
  if (range.end && t > toMs(range.end)) return false;
  return true;
}

// Timestamps carry offsets, so sort on parsed time rather than the string index order.
const byTime = <T extends { timestamp: string }>(a: T, b: T) => toMs(a.timestamp) - toMs(b.timestamp);

export function createRepo(dbName = 'ayu') {
  let dbPromise: Promise<IDBPDatabase<AyuDB>> | undefined;

  const db = () =>
    (dbPromise ??= openDB<AyuDB>(dbName, DB_VERSION, {
      upgrade(database) {
        const m = database.createObjectStore('measurements', { keyPath: 'id' });
        m.createIndex('timestamp', 'timestamp');
        m.createIndex('type', 'type');
        const c = database.createObjectStore('context', { keyPath: 'id' });
        c.createIndex('timestamp', 'timestamp');
        const s = database.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('timestamp', 'timestamp');
        s.createIndex('kind', 'kind');
      },
    }));

  return {
    async addMeasurement(m: Measurement): Promise<Measurement> {
      assertValid(validateMeasurement(m));
      await (await db()).add('measurements', m);
      return m;
    },

    async listMeasurements(type?: MeasurementType, range?: TimeRange): Promise<Measurement[]> {
      const d = await db();
      const rows = type ? await d.getAllFromIndex('measurements', 'type', type) : await d.getAll('measurements');
      return rows.filter((r) => inRange(r.timestamp, range)).sort(byTime);
    },

    async addContext(c: ContextEntry): Promise<ContextEntry> {
      assertValid(validateContextEntry(c));
      await (await db()).add('context', c);
      return c;
    },

    async listContext(range?: TimeRange): Promise<ContextEntry[]> {
      const rows = await (await db()).getAll('context');
      return rows.filter((r) => inRange(r.timestamp, range)).sort(byTime);
    },

    async addSession(s: Session): Promise<Session> {
      assertValid(validateSession(s));
      await (await db()).add('sessions', s);
      return s;
    },

    async listSessions(range?: TimeRange): Promise<Session[]> {
      const rows = await (await db()).getAll('sessions');
      return rows.filter((r) => inRange(r.timestamp, range)).sort(byTime);
    },

    /** Deletes the record with this id from whichever store holds it. Returns true if something was deleted. */
    async deleteEntry(id: string): Promise<boolean> {
      const d = await db();
      const tx = d.transaction(STORES, 'readwrite');
      let deleted = false;
      for (const name of STORES) {
        const store = tx.objectStore(name);
        if ((await store.getKey(id)) !== undefined) {
          await store.delete(id);
          deleted = true;
        }
      }
      await tx.done;
      return deleted;
    },

    /** Validates every record first, then writes all of them in one transaction (all or nothing). */
    async addMany(records: { measurements?: Measurement[]; context?: ContextEntry[] }): Promise<void> {
      const ms = records.measurements ?? [];
      const cs = records.context ?? [];
      ms.forEach((m) => assertValid(validateMeasurement(m)));
      cs.forEach((c) => assertValid(validateContextEntry(c)));
      const tx = (await db()).transaction(['measurements', 'context'], 'readwrite');
      await Promise.all([
        ...ms.map((m) => tx.objectStore('measurements').put(m)),
        ...cs.map((c) => tx.objectStore('context').put(c)),
      ]);
      await tx.done;
    },

    /** Removes only records flagged demo: true; live entries are untouched. Returns how many were removed. */
    async deleteDemo(): Promise<number> {
      const tx = (await db()).transaction(STORES, 'readwrite');
      let removed = 0;
      for (const name of STORES) {
        let cursor = await tx.objectStore(name).openCursor();
        while (cursor) {
          if (cursor.value.demo === true) {
            await cursor.delete();
            removed++;
          }
          cursor = await cursor.continue();
        }
      }
      await tx.done;
      return removed;
    },

    async hasDemo(): Promise<boolean> {
      const d = await db();
      const [ms, cs] = await Promise.all([d.getAll('measurements'), d.getAll('context')]);
      return ms.some((m) => m.demo) || cs.some((c) => c.demo);
    },

    async deleteAll(): Promise<void> {
      const d = await db();
      const tx = d.transaction(STORES, 'readwrite');
      await Promise.all(STORES.map((name) => tx.objectStore(name).clear()));
      await tx.done;
    },

    async exportJSON(): Promise<string> {
      const d = await db();
      const [measurements, context, sessions] = await Promise.all([
        d.getAll('measurements'),
        d.getAll('context'),
        d.getAll('sessions'),
      ]);
      return JSON.stringify(
        {
          app: 'ayu',
          schemaVersion: DB_VERSION,
          exportedAt: nowIso(),
          measurements: measurements.sort(byTime),
          context: context.sort(byTime),
          sessions: sessions.sort(byTime),
        },
        null,
        2,
      );
    },

    /** Closes the connection (tests, or before deleting the database). */
    async close(): Promise<void> {
      if (dbPromise) (await dbPromise).close();
      dbPromise = undefined;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

export const repo = createRepo();
