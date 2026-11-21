'use client';

import { useEffect, useState } from 'react';

export interface HouseholdMemberName {
  slug: string;
  name: string;
}

let cache: Promise<HouseholdMemberName[]> | null = null;

/** The household's members (`/api/household`), fetched once per page load. */
export function useHousehold(): HouseholdMemberName[] {
  const [members, setMembers] = useState<HouseholdMemberName[]>([]);
  useEffect(() => {
    cache ??= fetch('/api/household')
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => []);
    let live = true;
    cache.then((list) => live && setMembers(list));
    return () => {
      live = false;
    };
  }, []);
  return members;
}
