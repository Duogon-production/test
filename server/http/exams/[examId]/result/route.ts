import 'server-only';

import { getResult, requireStudentActor } from '@/server/services/exams';
import { respond, type ExamParams } from '@/server/http/exams/respond';

export async function GET(_req: Request, { params }: ExamParams) {
	return respond('GET exam result', async () => {
		const { examId } = await params;
		return getResult(await requireStudentActor(), examId);
	});
}
