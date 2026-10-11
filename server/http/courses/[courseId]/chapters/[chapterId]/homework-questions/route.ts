import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { db } from '@/server/db';
import { isAdminOrTeacher } from '@/server/services/teacher';
import { MAX_QUESTIONS_PER_SEGMENT } from '@/shared/homework';
import { normalizeOptionalImageUrl } from '@/shared/image-url';

type Params = { params: Promise<{ courseId: string; chapterId: string }> };

const MAX_TEXT = 8000;

const cleanText = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null;

export async function GET(_req: Request, { params: paramsPromise }: Params) {
	const { courseId, chapterId } = await paramsPromise;
	const { userId, sessionClaims } = await auth();
	if (!(await isAdminOrTeacher(userId, sessionClaims))) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	const questions = await db.homeworkQuestion.findMany({
		where: { chapterId, chapter: { courseId } },
		orderBy: { position: 'asc' },
	});
	return NextResponse.json(questions);
}

/**
 * Replaces the full question list of a segment (the builder saves as one unit).
 * Question text is mandatory; images (external URLs) and answers are optional.
 */
export async function PUT(req: Request, { params: paramsPromise }: Params) {
	const { courseId, chapterId } = await paramsPromise;
	try {
		const { userId, sessionClaims } = await auth();
		if (!(await isAdminOrTeacher(userId, sessionClaims))) {
			return new NextResponse('Unauthorized', { status: 401 });
		}

		const chapter = await db.chapter.findUnique({ where: { id: chapterId, courseId } });
		if (!chapter) return new NextResponse('Not Found', { status: 404 });

		const body: unknown = await req.json();
		const items = body && typeof body === 'object' ? (body as { questions?: unknown }).questions : undefined;
		if (!Array.isArray(items)) {
			return new NextResponse('A questions array is required.', { status: 400 });
		}
		if (items.length > MAX_QUESTIONS_PER_SEGMENT) {
			return new NextResponse(`At most ${MAX_QUESTIONS_PER_SEGMENT} questions are allowed.`, { status: 400 });
		}

		const data: {
			chapterId: string;
			position: number;
			text: string;
			imageUrl: string | null;
			answer: string | null;
			answerImageUrl: string | null;
		}[] = [];

		for (let index = 0; index < items.length; index++) {
			const item = (items[index] ?? {}) as Record<string, unknown>;
			const text = cleanText(item.text);
			if (!text) {
				return new NextResponse(`Question ${index + 1} needs question text.`, { status: 400 });
			}
			const imageUrl = normalizeOptionalImageUrl(item.imageUrl);
			const answerImageUrl = normalizeOptionalImageUrl(item.answerImageUrl);
			if (imageUrl === undefined || answerImageUrl === undefined) {
				return new NextResponse(`Question ${index + 1} has an invalid image URL (use a full http(s) link).`, { status: 400 });
			}
			data.push({
				chapterId,
				position: index + 1,
				text,
				imageUrl,
				answer: cleanText(item.answer),
				answerImageUrl,
			});
		}

		const saved = await db.$transaction(async (tx) => {
			await tx.homeworkQuestion.deleteMany({ where: { chapterId } });
			if (data.length) await tx.homeworkQuestion.createMany({ data });
			return tx.homeworkQuestion.findMany({ where: { chapterId }, orderBy: { position: 'asc' } });
		});

		return NextResponse.json(saved);
	} catch (error) {
		console.error('[ERROR] PUT homework-questions', error);
		return new NextResponse('Internal Server Error', { status: 500 });
	}
}
