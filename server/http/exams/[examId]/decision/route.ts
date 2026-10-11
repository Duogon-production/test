import 'server-only';

import { decide, requireStudentActor } from '@/server/services/exams';
import { readJson, respond, type ExamParams } from '@/server/http/exams/respond';

export async function POST(req: Request, { params }: ExamParams) {
	return respond('POST exam decision', async () => {
		const { examId } = await params;
		const actor = await requireStudentActor();
		const body = (await readJson(req)) as { decision?: unknown };
		return decide(actor, examId, body.decision);
	});
}
