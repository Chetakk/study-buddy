import { useCallback, useEffect, useState } from 'react';

// Fetches on mount and whenever `key` changes; `reload` refetches without a loading flash.
export function useLoad<T>(load: () => Promise<T>, key: unknown = null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  return { data, error, reload, setData };
}
