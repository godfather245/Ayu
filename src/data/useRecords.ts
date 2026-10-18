import { useCallback, useEffect, useState } from 'react';
import { repo } from './repo';
import type { ContextEntry, Measurement } from './schema';

/** Loads every measurement and context entry; call reload() after a write. */
export function useRecords() {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [context, setContext] = useState<ContextEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [ms, cs] = await Promise.all([repo.listMeasurements(), repo.listContext()]);
      setMeasurements(ms);
      setContext(cs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { measurements, context, loaded, error, reload };
}
