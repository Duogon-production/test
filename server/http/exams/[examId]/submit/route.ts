import 'server-only';

import { requireStudentActor, submitAttempt } from '@/server/services/exams';
import { readJson, respond, type ExamParams } from '@/server/http/exams/respond';

export async function POST(req: Request, { params }: ExamParams) {
	return respond('POST exam submit', async () => {
		const { examId } = await params;
		const actor = await requireStudentActor();
		const body = (await readJson(req)) as { answers?: unknown };
		return submitAttempt(actor, examId, body.answers);
	});
}
