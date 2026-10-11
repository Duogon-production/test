import 'server-only';

import { db } from '@/server/db';
import { Attachment, Chapter } from '@prisma/client';
import type { HomeworkQuestion } from '@/shared/contracts/courses';

interface GetChapterProps {
	userId: string;
	courseId: string;
	chapterId: string;
}

export const getChapter = async ({
	userId,
	courseId,
	chapterId,
}: GetChapterProps) => {
	try {
		const dbUser = await db.user.findFirst({
			where: {
				OR: [{ id: userId }, { externalId: userId }],
			},
		});
		const targetUserId = dbUser ? dbUser.id : userId;

		const course = await db.course.findUnique({
			where: {
				id: courseId,
				isPublished: true,
			},
			include: {
				chapters: {
					where: { isPublished: true },
					orderBy: { position: 'asc' },
					include: {
						userProgresses: {
							where: { userId },
						},
						homeworkSubmissions: {
							where: { userId: targetUserId },
						},
					},
				},
			},
		});

		const chapter = await db.chapter.findUnique({
			where: {
				id: chapterId,
				courseId,
				isPublished: true,
			},
		});

		if (!chapter || !course) {
			throw new Error('Chapter or course not found');
		}

		let muxData = null;
		let attachments: Attachment[] = [];
		let nextChapter: Chapter | null = null;

		if (chapter.isFree) {
			attachments = await db.attachment.findMany({
				where: {
					chapterId,
				},
			});
		}

		if (chapter.isFree) {
			muxData = await db.muxData.findUnique({
				where: {
					chapterId,
				},
			});

			nextChapter = await db.chapter.findFirst({
				where: {
					courseId,
					isPublished: true,
					position: {
						gt: chapter?.position,
					},
				},
				orderBy: {
					position: 'asc',
				},
			});
		}

		const userProgress = await db.userProgress.findUnique({
			where: {
				userId_chapterId: {
					userId,
					chapterId,
				},
			},
		});

		const homeworkSubmission = await db.submission.findUnique({
			where: {
				userId_chapterId: {
					userId: targetUserId,
					chapterId,
				},
			},
		});

		// Platform-authored questions. Answers are withheld until the student has submitted.
		let homeworkQuestions: HomeworkQuestion[] = [];
		if (chapter.homeworkMode === 'PLATFORM_QUESTIONS') {
			const rows = await db.homeworkQuestion.findMany({
				where: { chapterId },
				orderBy: { position: 'asc' },
			});
			homeworkQuestions = rows.map((row) => ({
				id: row.id,
				chapterId: row.chapterId,
				position: row.position,
				text: row.text,
				imageUrl: row.imageUrl,
				...(homeworkSubmission
					? { answer: row.answer, answerImageUrl: row.answerImageUrl }
					: {}),
			}));
		}

		return {
			chapter,
			course,
			muxData,
			attachments,
			nextChapter,
			userProgress,
			homeworkSubmission,
			homeworkQuestions,
		};
	} catch (error) {
		console.log('[ERROR] getChapter', error);

		return {
			chapter: null,
			course: null,
			muxData: null,
			attachments: [],
			nextChapter: null,
			userProgress: null,
			homeworkSubmission: null,
			homeworkQuestions: [] as HomeworkQuestion[],
		};
	}
};
