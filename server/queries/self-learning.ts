import 'server-only';

import { db } from '@/server/db';

import { chapterKey, DEFAULT_CHAPTER_TYPE } from '@/shared/chapter-label';
import type { SelfLearningChapter, SelfLearningLesson } from '@/shared/contracts/dashboard';

export async function getSelfLearningChapters(userId: string): Promise<SelfLearningChapter[]> {
	const courses = await db.course.findMany({
		where: {
			isPublished: true,
		},
		include: {
			chapters: {
				where: { isPublished: true },
				orderBy: { position: 'asc' },
				include: {
					userProgresses: {
						where: { userId },
						select: { isCompleted: true },
					},
				},
			},
		},
		orderBy: [{ chapterNumber: 'asc' }, { createdAt: 'asc' }],
	});

	// Transform to SelfLearningLesson
	const lessons: SelfLearningLesson[] = courses.map((course) => ({
		id: course.id,
		title: course.title,
		description: course.description,
		imageUrl: course.imageUrl,
		chapterType: course.chapterType,
		chapterNumber: course.chapterNumber,
		chapters: course.chapters.map((chapter) => ({
			id: chapter.id,
			title: chapter.title,
			isCompleted: chapter.userProgresses[0]?.isCompleted ?? false,
		})),
	}));

	// Group lessons by [type] [number]; names, summaries and descriptions come from the ChapterInfo table
	// (edited by admins/teachers). A group with no ChapterInfo row still shows, as just "Chapter 3".
	const infoRows = await db.chapterInfo.findMany();
	const infoByKey = new Map(infoRows.map((row) => [chapterKey(row.type, row.number), row]));

	const groups = new Map<string, SelfLearningChapter>();
	for (const lesson of lessons) {
		if (lesson.chapterNumber === null) continue;
		const key = chapterKey(lesson.chapterType, lesson.chapterNumber);
		let group = groups.get(key);
		if (!group) {
			const info = infoByKey.get(key);
			group = {
				type: info?.type ?? (lesson.chapterType || DEFAULT_CHAPTER_TYPE),
				number: lesson.chapterNumber,
				title: info?.name ?? '',
				subtitle: info?.summary ?? '',
				description: info?.description ?? '',
				lessonCount: 0,
				lessons: [],
			};
			groups.set(key, group);
		}
		group.lessons.push(lesson);
		group.lessonCount += 1;
	}

	// Only groups with at least one published lesson render. Order: by type, then number.
	return [...groups.values()].sort(
		(a, b) => a.type.localeCompare(b.type) || a.number - b.number
	);
}
