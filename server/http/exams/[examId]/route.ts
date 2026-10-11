import 'server-only';

import {
	ExamError,
	deleteExam,
	getExamForStaff,
	getRunState,
	requireExamActor,
	requireStaffActor,
	setExamPublished,
	updateExam,
} from '@/server/services/exams';
import { readJson, respond, type ExamParams } from '@/server/http/exams/respond';

/** Staff receive the editable exam with its answer key; students receive their run state (no answer key). */
export async function GET(_req: Request, { params }: ExamParams) {
	return respond('GET exam', async () => {
		const { examId } = await params;
		const actor = await requireExamActor();
		return actor.isStaff ? getExamForStaff(examId) : getRunState(actor, examId);
	});
}

export async function PUT(req: Request, { params }: ExamParams) {
	return respond('PUT exam', async () => {
		const { examId } = await params;
		await requireStaffActor();
		return updateExam(examId, await readJson(req));
	});
}

/** Quick publish/unpublish without resending the whole exam. */
export async function PATCH(req: Request, { params }: ExamParams) {
	return respond('PATCH exam', async () => {
		const { examId } = await params;
		await requireStaffActor();
		const body = (await readJson(req)) as { isPublished?: unknown };
		if (typeof body.isPublished !== 'boolean') {
			throw new ExamError(400, 'isPublished must be a boolean.');
		}
		await setExamPublished(examId, body.isPublished);
		return { isPublished: body.isPublished };
	});
}

export async function DELETE(_req: Request, { params }: ExamParams) {
	return respond('DELETE exam', async () => {
		const { examId } = await params;
		await requireStaffActor();
		await deleteExam(examId);
		return { deleted: true };
	});
}
