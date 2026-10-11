import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { db } from '@/server/db';
import { isAdminOrTeacher } from '@/server/services/teacher';
import { parseChapterInfo } from '@/shared/chapter-label';

/** Every named chapter group. Staff only: the editor uses it to pre-fill the details form. */
export async function GET() {
	try {
		const { userId, sessionClaims } = await auth();
		if (!userId) return new NextResponse('Unauthorized', { status: 401 });
		if (!(await isAdminOrTeacher(userId, sessionClaims))) return new NextResponse('Forbidden', { status: 403 });

		const rows = await db.chapterInfo.findMany({ orderBy: [{ type: 'asc' }, { number: 'asc' }] });
		return NextResponse.json(rows);
	} catch (error) {
		console.error('[ERROR] GET /api/chapter-info', error);
		return new NextResponse('Internal Server Error', { status: 500 });
	}
}

/** Creates or updates the name, short summary and optional description for one [Type] [Number]. */
export async function PUT(req: Request) {
	try {
		const { userId, sessionClaims } = await auth();
		if (!userId) return new NextResponse('Unauthorized', { status: 401 });
		if (!(await isAdminOrTeacher(userId, sessionClaims))) return new NextResponse('Forbidden', { status: 403 });

		let body: unknown = {};
		try {
			body = await req.json();
		} catch {
			/* handled by validation */
		}
		const parsed = parseChapterInfo(body);
		if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });

		const { type, number, ...fields } = parsed.value;
		// Type match is case-insensitive so "month" and "Month" can't create two groups.
		const existing = await db.chapterInfo.findFirst({
			where: { type: { equals: type, mode: 'insensitive' }, number },
		});
		const row = existing
			? await db.chapterInfo.update({ where: { id: existing.id }, data: { type, ...fields } })
			: await db.chapterInfo.create({ data: { type, number, ...fields } });
		return NextResponse.json(row);
	} catch (error) {
		console.error('[ERROR] PUT /api/chapter-info', error);
		return new NextResponse('Internal Server Error', { status: 500 });
	}
}
