import { NextResponse } from 'next/server';
import { members } from '@/lib/household';

export const dynamic = 'force-dynamic';

/** The household's members, names only — what client pages need to label and filter by owner. */
export async function GET() {
  return NextResponse.json(members().map(({ slug, name }) => ({ slug, name })));
}
