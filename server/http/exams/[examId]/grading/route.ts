import 'server-only';

import { getGrading, requireStaffActor } from '@/server/services/exams';
import { respond, type ExamParams } from '@/server/http/exams/respond';

export async function GET(_req: Request, { params }: ExamParams) {
	return respond('GET exam grading', async () => {
		const { examId } = await params;
		await requireStaffActor();
		return getGrading(examId);
	});
}
