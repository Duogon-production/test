import 'server-only';

import { NextResponse } from 'next/server';

import { ExamError } from '@/server/services/exams';

/** Runs an exam handler and maps ExamError to its HTTP status; anything else is a 500. */
export async function respond<T>(label: string, run: () => Promise<T>) {
	try {
		return NextResponse.json(await run());
	} catch (error) {
		if (error instanceof ExamError) return new NextResponse(error.message, { status: error.status });
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

export type ExamParams = { params: Promise<{ examId: string }> };
export type GradingParams = { params: Promise<{ examId: string; sessionId: string }> };
