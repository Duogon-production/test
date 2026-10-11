import 'server-only';

import { NextResponse } from 'next/server';

import { SupportError } from '@/server/services/support';

export async function respond<T>(label: string, run: () => Promise<T>) {
	try {
		return NextResponse.json(await run());
	} catch (error) {
		if (error instanceof SupportError) return new NextResponse(error.message, { status: error.status });
		console.error(`[ERROR] ${label}`, error);
		return new NextResponse('Internal Server Error', { status: 500 });
	}
}

export async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return {};
	}
}

export type TicketParams = { params: Promise<{ ticketId: string }> };
