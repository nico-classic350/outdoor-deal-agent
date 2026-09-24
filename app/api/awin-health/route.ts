import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TARGETS = [
  { id: 14102, name: 'Bergfreunde DE' },
  { id: 12557, name: 'Bergzeit DE/AT' },
  { id: 14607, name: 'SportScheck DE' },
];

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [] as Record<string,string>[];
  const headers = lines[0].split(',').map(x => x.replace(/^"|"$/g,'').trim());
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    const row: Record<string,string> = {};
    headers.forEach((h,i) => row[h] = (parts[i] ?? '').replace(/^"|"$/g,'').trim());
    return row;
  });
}

export async function GET() {
  const key = process.env.AWIN_DATAFEED_API_KEY;
  if (!key) {
    return NextResponse.json({
      ok: true,
      awinConfigured: false,
      targets: TARGETS.map(x => ({ ...x, accessible: false })),
    });
  }

  try {
    const r = await fetch(
      'https://productdata.awin.com/datafeed/list/apikey/' + encodeURIComponent(key),
      { headers: { 'user-agent': 'OutdoorDealAgent/1.0' }, signal: AbortSignal.timeout(20000) }
    );
    if (!r.ok) {
      return NextResponse.json({
        ok: false,
        awinConfigured: true,
        feedListReachable: false,
        httpStatus: r.status,
      }, { status: 502 });
    }

    const text = await r.text();
    const rows = parseCsv(text);
    const ids = new Set(rows.map(row =>
      Number(row['Advertiser ID'] || row['Advertiser Id'] || row['advertiser_id'])
    ).filter(Boolean));

    return NextResponse.json({
      ok: true,
      awinConfigured: true,
      feedListReachable: true,
      feedCount: rows.length,
      targets: TARGETS.map(x => ({ ...x, accessible: ids.has(x.id) })),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      awinConfigured: true,
      feedListReachable: false,
      error: 'awin_feed_list_unreachable',
    }, { status: 502 });
  }
}
