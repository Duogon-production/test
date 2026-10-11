import 'server-only';

import { createExam, listExams, requireExamActor, requireStaffActor } from '@/server/services/exams';
import { readJson, respond } from '@/server/http/exams/respond';

export async function GET() {
	return respond('GET exams', async () => listExams(await requireExamActor()));
}

export async function POST(req: Request) {
	return respond('POST exams', async () => {
		const actor = await requireStaffActor();
		return createExam(actor, await readJson(req));
	});
}
