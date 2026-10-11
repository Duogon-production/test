import 'server-only';

import { gradeSession, requireStaffActor } from '@/server/services/exams';
import { readJson, respond, type GradingParams } from '@/server/http/exams/respond';

export async function PATCH(req: Request, { params }: GradingParams) {
	return respond('PATCH exam grading', async () => {
		const { examId, sessionId } = await params;
		const actor = await requireStaffActor();
		return gradeSession(actor, examId, sessionId, await readJson(req));
	});
}
