'use client';

import { useState, useEffect, useMemo } from 'react';

interface AccountType {
  id: string;
  name: string;
  color: string;
  show_in_growth: boolean;
  is_equity: boolean;
}

interface UseAccountTypesResult {
  types: AccountType[];
  typeColors: Record<string, string>;
  typeIds: Record<string, string>;
  growthTypes: string[];
  equityTypes: string[];
  loading: boolean;
}

export function useAccountTypes(): UseAccountTypesResult {
  const [types, setTypes] = useState<AccountType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portfolio/account-types')
      .then((r) => r.json())
      .then((data: AccountType[]) => {
        setTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => setTypes([]))
      .finally(() => setLoading(false));
  }, []);

  const typeColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of types) map[t.name] = t.color;
    return map;
  }, [types]);

  // name → id map, for building /portfolio/types/[typeId] links
  const typeIds = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of types) map[t.name] = t.id;
    return map;
  }, [types]);

  const growthTypes = useMemo(
    () => types.filter((t) => t.show_in_growth).map((t) => t.name),
    [types]
  );

  const equityTypes = useMemo(
    () => types.filter((t) => t.is_equity).map((t) => t.name),
    [types]
  );

  return { types, typeColors, typeIds, growthTypes, equityTypes, loading };
}
