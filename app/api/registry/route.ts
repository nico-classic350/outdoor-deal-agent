import { NextResponse } from 'next/server';
import { SHOPS } from '../../../config/shops';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    count: SHOPS.length,
    shops: SHOPS,
  });
}
