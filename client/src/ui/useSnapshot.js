import { useEffect, useState } from 'react';

const EMPTY = { reports: [], counts: { drafts: 0, pending: 0, synchronized: 0, failed: 0 } };

// Re-reads the local store whenever the app state says something changed.
export function useSnapshot(app) {
  const [snap, setSnap] = useState(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await app.snapshot();
      if (alive) setSnap(s);
    };
    load();
    const off = app.subscribe(load);
    return () => { alive = false; off(); };
  }, [app]);
  return snap;
}
