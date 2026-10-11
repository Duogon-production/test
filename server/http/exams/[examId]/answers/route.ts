import 'server-only';

import { requireStudentActor, saveDraft } from '@/server/services/exams';
import { readJson, respond, type ExamParams } from '@/server/http/exams/respond';

/** Autosave of the in-progress attempt. */
export async function PUT(req: Request, { params }: ExamParams) {
	return respond('PUT exam answers', async () => {
		const { examId } = await params;
		const actor = await requireStudentActor();
		const body = (await readJson(req)) as { answers?: unknown };
		await saveDraft(actor, examId, body.answers);
		return { saved: true };
	});
}
