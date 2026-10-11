import 'server-only';

import { requireStudentActor, startExam } from '@/server/services/exams';
import { respond, type ExamParams } from '@/server/http/exams/respond';

export async function POST(_req: Request, { params }: ExamParams) {
	return respond('POST exam start', async () => {
		const { examId } = await params;
		return startExam(await requireStudentActor(), examId);
	});
}
