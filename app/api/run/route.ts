import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function retired() {
  return NextResponse.json(
    {
      ok: false,
      error: 'monolithic_run_retired',
      message: 'The crawler uses the batched pipeline to stay within Vercel Hobby runtime limits.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
export async function GET() { return retired(); }
export async function POST() { return retired(); }
