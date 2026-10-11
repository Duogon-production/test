import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';

import { db } from '@/server/db';
import { isAdminOrTeacher } from '@/server/services/teacher';
import { getDbUser } from '@/server/services/user';
import type {
	ExamEditable,
	ExamResult,
	ExamResultQuestion,
	ExamRunQuestion,
	ExamRunState,
	ExamSummary,
	GradingPayload,
	StudentExamState,
} from '@/shared/contracts/exams';
import {
	SUBMIT_GRACE_SECONDS,
	parseExamInput,
	parseWrittenScores,
	sanitizeAnswers,
	scoreMcq,
	shouldAutoFinalize,
	type ExamAnswers,
	type ExamInput,
	type GradableQuestion,
	type WrittenStatus,
} from '@/shared/exams';

export class ExamError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface ExamActor {
	userId: string;
	name: string | null;
	isStaff: boolean;
}

/** Signed-in actor. Unapproved students cannot use exams (the waitlist overlay is UI only). */
export async function requireExamActor(): Promise<ExamActor> {
	const { userId, sessionClaims } = await auth();
	if (!userId) throw new ExamError(401, 'Unauthorized');
	const user = await getDbUser(userId);
	const isStaff = await isAdminOrTeacher(userId, sessionClaims);
	if (!user) {
		if (isStaff) return { userId, name: null, isStaff: true };
		throw new ExamError(404, 'User not found in system.');
	}
	if (!isStaff && !user.isApproved) throw new ExamError(403, 'Your account is awaiting approval.');
	return { userId: user.id, name: user.name, isStaff };
}

export async function requireStaffActor(): Promise<ExamActor> {
	const actor = await requireExamActor();
	if (!actor.isStaff) throw new ExamError(403, 'Only admin or teacher accounts can do this.');
	return actor;
}

export async function requireStudentActor(): Promise<ExamActor> {
	const actor = await requireExamActor();
	if (actor.isStaff) throw new ExamError(403, 'Staff accounts cannot take exams.');
	return actor;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

type QuestionRow = Prisma.ExamQuestionGetPayload<object>;

const choicesOf = (row: QuestionRow): string[] | null =>
	Array.isArray(row.choices) ? (row.choices as unknown[]).map(String) : null;

const toGradable = (rows: QuestionRow[]): GradableQuestion[] =>
	rows.map((row) => ({
		id: row.id,
		type: row.type,
		choiceCount: choicesOf(row)?.length,
		correctChoice: row.correctChoice,
		points: row.points,
	}));

const asAnswers = (value: Prisma.JsonValue | null | undefined): ExamAnswers =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as ExamAnswers) : {};

const maxAttemptsOf = (value: number): 1 | 2 => (value >= 2 ? 2 : 1);

const toRunQuestion = (row: QuestionRow): ExamRunQuestion => ({
	id: row.id,
	position: row.position,
	type: row.type === 'WRITTEN' ? 'WRITTEN' : 'MCQ',
	text: row.text,
	imageUrl: row.imageUrl,
	choices: choicesOf(row),
	points: row.points,
});

const deadlineFor = (startedAt: Date, durationMinutes: number | null): Date | null =>
	durationMinutes === null ? null : new Date(startedAt.getTime() + durationMinutes * 60_000);

const isPastDeadline = (startedAt: Date, durationMinutes: number | null, now = new Date()) => {
	const deadline = deadlineFor(startedAt, durationMinutes);
	return !!deadline && now.getTime() > deadline.getTime() + SUBMIT_GRACE_SECONDS * 1000;
};

const isUniqueViolation = (error: unknown) =>
	error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// ---------------------------------------------------------------------------
// Staff: exam CRUD
// ---------------------------------------------------------------------------

export async function listExams(actor: ExamActor): Promise<ExamSummary[]> {
	if (actor.isStaff) {
		const exams = await db.exam.findMany({
			orderBy: { createdAt: 'desc' },
			include: {
				_count: { select: { questions: true, sessions: true } },
				sessions: { where: { writtenStatus: 'UNDER_CORRECTION' }, select: { id: true } },
			},
		});
		return exams.map((exam) => ({
			id: exam.id,
			title: exam.title,
			description: exam.description,
			durationMinutes: exam.durationMinutes,
			maxAttempts: maxAttemptsOf(exam.maxAttempts),
			isPublished: exam.isPublished,
			questionCount: exam._count.questions,
			sessionCount: exam._count.sessions,
			underCorrectionCount: exam.sessions.length,
		}));
	}

	const exams = await db.exam.findMany({
		where: { isPublished: true },
		orderBy: { createdAt: 'desc' },
		include: {
			questions: { select: { type: true, points: true } },
			sessions: { where: { userId: actor.userId } },
		},
	});

	return exams.map((exam) => {
		const session = exam.sessions[0];
		const mcqTotal = exam.questions.filter((q) => q.type === 'MCQ').reduce((sum, q) => sum + q.points, 0);
		const writtenTotal = exam.questions.filter((q) => q.type === 'WRITTEN').reduce((sum, q) => sum + q.points, 0);

		let state: StudentExamState = 'NOT_STARTED';
		if (session) {
			if (session.status === 'IN_PROGRESS') state = 'IN_PROGRESS';
			else if (session.status === 'AWAITING_DECISION') state = 'AWAITING_DECISION';
			else if (session.writtenStatus === 'UNDER_CORRECTION') state = 'UNDER_CORRECTION';
			else if (session.writtenStatus === 'GRADED') state = 'GRADED';
			else state = 'SUBMITTED';
		}
		const final = session && session.status === 'FINALIZED' ? session : null;
		const graded = final?.writtenStatus === 'GRADED';

		return {
			id: exam.id,
			title: exam.title,
			description: exam.description,
			durationMinutes: exam.durationMinutes,
			maxAttempts: maxAttemptsOf(exam.maxAttempts),
			isPublished: true,
			questionCount: exam.questions.length,
			state,
			mcqScore: final ? final.mcqScore : null,
			mcqTotal: final ? (final.mcqTotal ?? mcqTotal) : null,
			// A combined mark is only shown once nothing is waiting for correction.
			totalScore: final && (graded || writtenTotal === 0) ? (final.mcqScore ?? 0) + (final.writtenScore ?? 0) : null,
			totalPossible: mcqTotal + writtenTotal,
		};
	});
}

export async function getExamForStaff(examId: string): Promise<ExamEditable> {
	const exam = await db.exam.findUnique({
		where: { id: examId },
		include: { questions: { orderBy: { position: 'asc' } }, _count: { select: { sessions: true } } },
	});
	if (!exam) throw new ExamError(404, 'Exam not found.');
	return {
		role: 'staff',
		id: exam.id,
		title: exam.title,
		description: exam.description,
		durationMinutes: exam.durationMinutes,
		maxAttempts: maxAttemptsOf(exam.maxAttempts),
		isPublished: exam.isPublished,
		isLocked: exam._count.sessions > 0,
		questions: exam.questions.map((q) => ({
			id: q.id,
			type: q.type === 'WRITTEN' ? 'WRITTEN' : 'MCQ',
			text: q.text,
			imageUrl: q.imageUrl,
			choices: choicesOf(q),
			correctChoice: q.correctChoice,
			points: q.points,
		})),
	};
}

const questionRows = (examId: string, input: ExamInput) =>
	input.questions.map((q, index) => ({
		examId,
		position: index + 1,
		type: q.type,
		text: q.text,
		imageUrl: q.imageUrl,
		choices: q.choices ?? Prisma.JsonNull,
		correctChoice: q.correctChoice,
		points: q.points,
	}));

export async function createExam(actor: ExamActor, body: unknown) {
	const parsed = parseExamInput(body);
	if (!parsed.ok) throw new ExamError(400, parsed.error);
	const input = parsed.value;
	const exam = await db.exam.create({
		data: {
			title: input.title,
			description: input.description,
			durationMinutes: input.durationMinutes,
			maxAttempts: input.maxAttempts,
			isPublished: input.isPublished,
			createdBy: actor.userId,
		},
	});
	await db.examQuestion.createMany({ data: questionRows(exam.id, input) });
	return getExamForStaff(exam.id);
}

export async function updateExam(examId: string, body: unknown) {
	const parsed = parseExamInput(body);
	if (!parsed.ok) throw new ExamError(400, parsed.error);
	const input = parsed.value;

	const existing = await db.exam.findUnique({
		where: { id: examId },
		include: { _count: { select: { sessions: true } } },
	});
	if (!existing) throw new ExamError(404, 'Exam not found.');

	if (existing._count.sessions > 0) {
		// Students already have attempts: changing questions or limits would corrupt their history.
		await db.exam.update({
			where: { id: examId },
			data: { title: input.title, description: input.description, isPublished: input.isPublished },
		});
	} else {
		await db.$transaction([
			db.exam.update({
				where: { id: examId },
				data: {
					title: input.title,
					description: input.description,
					durationMinutes: input.durationMinutes,
					maxAttempts: input.maxAttempts,
					isPublished: input.isPublished,
				},
			}),
			db.examQuestion.deleteMany({ where: { examId } }),
			db.examQuestion.createMany({ data: questionRows(examId, input) }),
		]);
	}
	return getExamForStaff(examId);
}

export async function setExamPublished(examId: string, isPublished: boolean) {
	const result = await db.exam.updateMany({ where: { id: examId }, data: { isPublished } });
	if (!result.count) throw new ExamError(404, 'Exam not found.');
}

export async function deleteExam(examId: string) {
	const result = await db.exam.deleteMany({ where: { id: examId } });
	if (!result.count) throw new ExamError(404, 'Exam not found.');
}

// ---------------------------------------------------------------------------
// Student: lifecycle
// ---------------------------------------------------------------------------

async function loadPublishedExam(examId: string) {
	const exam = await db.exam.findFirst({
		where: { id: examId, isPublished: true },
		include: { questions: { orderBy: { position: 'asc' } } },
	});
	if (!exam) throw new ExamError(404, 'Exam not found.');
	return exam;
}

type LoadedExam = Awaited<ReturnType<typeof loadPublishedExam>>;

async function loadSession(examId: string, userId: string) {
	return db.examSession.findUnique({
		where: { examId_userId: { examId, userId } },
		include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
	});
}

type LoadedSession = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

/**
 * Moves a session forward after an attempt is submitted. Runs inside the
 * submit transaction so the attempt, score and session state change together.
 */
async function applySubmittedAttempt(
	tx: Prisma.TransactionClient,
	exam: LoadedExam,
	session: { id: string },
	attemptNumber: number,
	answers: ExamAnswers
) {
	const questions = toGradable(exam.questions);
	const mcq = scoreMcq(questions, answers);
	const maxAttempts = maxAttemptsOf(exam.maxAttempts);
	const finalize = shouldAutoFinalize({ maxAttempts, attemptNumber, hasMistakes: mcq.hasMistakes });
	const hasWritten = exam.questions.some((q) => q.type === 'WRITTEN');

	await tx.examAttempt.update({
		where: { sessionId_attemptNumber: { sessionId: session.id, attemptNumber } },
		data: { submittedAt: new Date(), answers: answers as Prisma.InputJsonValue, mcqScore: mcq.score },
	});

	if (finalize) {
		await tx.examSession.update({
			where: { id: session.id },
			data: finalizeData(mcq.score, mcq.total, hasWritten),
		});
	} else {
		await tx.examSession.update({
			where: { id: session.id },
			data: { status: 'AWAITING_DECISION', mcqScore: mcq.score, mcqTotal: mcq.total },
		});
	}
	return finalize ? 'FINALIZED' : 'AWAITING_DECISION';
}

const finalizeData = (mcqScore: number, mcqTotal: number, hasWritten: boolean) => ({
	status: 'FINALIZED',
	finalizedAt: new Date(),
	mcqScore,
	mcqTotal,
	// Essays are never auto-graded; they wait for an admin.
	writtenStatus: (hasWritten ? 'UNDER_CORRECTION' : 'NONE') as WrittenStatus,
});

/** Submits an attempt whose time ran out, using the last autosaved draft. */
async function settleExpired(exam: LoadedExam, session: LoadedSession): Promise<LoadedSession> {
	if (session.status !== 'IN_PROGRESS') return session;
	const attempt = session.attempts.find((a) => a.attemptNumber === session.currentAttempt);
	if (!attempt || attempt.submittedAt) return session;
	if (!isPastDeadline(attempt.startedAt, exam.durationMinutes)) return session;

	const answers = sanitizeAnswers(attempt.answers, toGradable(exam.questions));
	try {
		await db.$transaction(async (tx) => {
			// Guard against a concurrent manual submit.
			const claimed = await tx.examAttempt.updateMany({
				where: { id: attempt.id, submittedAt: null },
				data: { submittedAt: new Date() },
			});
			if (claimed.count !== 1) return;
			await applySubmittedAttempt(tx, exam, session, attempt.attemptNumber, answers);
		});
	} catch (error) {
		console.error('[EXAM_SETTLE_EXPIRED]', error);
	}
	return (await loadSession(exam.id, session.userId)) ?? session;
}

function buildRunState(exam: LoadedExam, session: LoadedSession | null): ExamRunState {
	const base = {
		role: 'student' as const,
		exam: {
			id: exam.id,
			title: exam.title,
			description: exam.description,
			durationMinutes: exam.durationMinutes,
			maxAttempts: maxAttemptsOf(exam.maxAttempts),
			questionCount: exam.questions.length,
		},
		serverNow: new Date().toISOString(),
	};
	if (!session) {
		return { ...base, status: 'NOT_STARTED', attemptNumber: 0, deadline: null, questions: [], answers: {}, writtenStatus: 'NONE' };
	}

	const writtenStatus = session.writtenStatus as WrittenStatus;
	if (session.status !== 'IN_PROGRESS') {
		// Nothing about the questions is needed (and nothing about the answer key is ever sent).
		return {
			...base,
			status: session.status === 'FINALIZED' ? 'FINALIZED' : 'AWAITING_DECISION',
			attemptNumber: session.currentAttempt,
			deadline: null,
			questions: [],
			answers: {},
			writtenStatus,
		};
	}

	const attempt = session.attempts.find((a) => a.attemptNumber === session.currentAttempt);
	const startedAt = attempt?.startedAt ?? new Date();
	return {
		...base,
		status: 'IN_PROGRESS',
		attemptNumber: session.currentAttempt,
		deadline: deadlineFor(startedAt, exam.durationMinutes)?.toISOString() ?? null,
		questions: exam.questions.map(toRunQuestion),
		answers: asAnswers(attempt?.answers),
		writtenStatus,
	};
}

export async function getRunState(actor: ExamActor, examId: string): Promise<ExamRunState> {
	const exam = await loadPublishedExam(examId);
	let session = await loadSession(examId, actor.userId);
	if (session) session = await settleExpired(exam, session);
	return buildRunState(exam, session);
}

export async function startExam(actor: ExamActor, examId: string): Promise<ExamRunState> {
	const exam = await loadPublishedExam(examId);
	if (!exam.questions.length) throw new ExamError(409, 'This exam has no questions yet.');

	let session = await loadSession(examId, actor.userId);
	if (!session) {
		try {
			await db.examSession.create({
				data: {
					examId,
					userId: actor.userId,
					attempts: { create: { attemptNumber: 1 } },
				},
			});
		} catch (error) {
			// A double click can race two creates; the unique key makes the second one a no-op.
			if (!isUniqueViolation(error)) throw error;
		}
		session = await loadSession(examId, actor.userId);
	}
	if (!session) throw new ExamError(500, 'Could not start the exam.');
	session = await settleExpired(exam, session);
	return buildRunState(exam, session);
}

export async function saveDraft(actor: ExamActor, examId: string, rawAnswers: unknown) {
	const exam = await loadPublishedExam(examId);
	const session = await loadSession(examId, actor.userId);
	if (!session || session.status !== 'IN_PROGRESS') throw new ExamError(409, 'No attempt is in progress.');
	const attempt = session.attempts.find((a) => a.attemptNumber === session.currentAttempt);
	if (!attempt || attempt.submittedAt) throw new ExamError(409, 'No attempt is in progress.');
	if (isPastDeadline(attempt.startedAt, exam.durationMinutes)) {
		throw new ExamError(409, 'Time is up for this attempt.');
	}
	const answers = sanitizeAnswers(rawAnswers, toGradable(exam.questions));
	const saved = await db.examAttempt.updateMany({
		where: { id: attempt.id, submittedAt: null },
		data: { answers: answers as Prisma.InputJsonValue },
	});
	if (saved.count !== 1) throw new ExamError(409, 'This attempt was already submitted.');
}

export async function submitAttempt(actor: ExamActor, examId: string, rawAnswers: unknown) {
	const exam = await loadPublishedExam(examId);
	const session = await loadSession(examId, actor.userId);
	if (!session || session.status !== 'IN_PROGRESS') throw new ExamError(409, 'No attempt is in progress.');
	const attempt = session.attempts.find((a) => a.attemptNumber === session.currentAttempt);
	if (!attempt || attempt.submittedAt) throw new ExamError(409, 'This attempt was already submitted.');

	const questions = toGradable(exam.questions);
	// Late submissions can't edit answers: only what was autosaved before the deadline counts.
	const late = isPastDeadline(attempt.startedAt, exam.durationMinutes);
	const answers = late
		? sanitizeAnswers(attempt.answers, questions)
		: sanitizeAnswers(rawAnswers, questions);

	const status = await db.$transaction(async (tx) => {
		const claimed = await tx.examAttempt.updateMany({
			where: { id: attempt.id, submittedAt: null },
			data: { submittedAt: new Date() },
		});
		if (claimed.count !== 1) throw new ExamError(409, 'This attempt was already submitted.');
		return applySubmittedAttempt(tx, exam, session, attempt.attemptNumber, answers);
	});
	// Deliberately minimal: no scores and no indication of which questions were wrong.
	return { status };
}

export async function decide(actor: ExamActor, examId: string, decision: unknown) {
	if (decision !== 'FINALIZE' && decision !== 'RETRY') {
		throw new ExamError(400, 'Decision must be FINALIZE or RETRY.');
	}
	const exam = await loadPublishedExam(examId);
	const session = await loadSession(examId, actor.userId);
	if (!session || session.status !== 'AWAITING_DECISION') {
		throw new ExamError(409, 'There is nothing to decide right now.');
	}

	if (decision === 'FINALIZE') {
		const claimed = await db.examSession.updateMany({
			where: { id: session.id, status: 'AWAITING_DECISION' },
			data: finalizeData(session.mcqScore ?? 0, session.mcqTotal ?? 0, exam.questions.some((q) => q.type === 'WRITTEN')),
		});
		if (claimed.count !== 1) throw new ExamError(409, 'Already decided.');
		return { status: 'FINALIZED' as const };
	}

	if (session.currentAttempt >= maxAttemptsOf(exam.maxAttempts)) {
		throw new ExamError(409, 'No attempts left.');
	}
	const nextAttempt = session.currentAttempt + 1;
	// Written answers carry over so photos/essays are not lost; MCQs start blank.
	const previous = session.attempts.find((a) => a.attemptNumber === session.currentAttempt);
	const carried: ExamAnswers = {};
	const prevAnswers = asAnswers(previous?.answers);
	for (const q of exam.questions) {
		if (q.type === 'WRITTEN' && prevAnswers[q.id]) carried[q.id] = prevAnswers[q.id];
	}

	await db.$transaction(async (tx) => {
		const claimed = await tx.examSession.updateMany({
			where: { id: session.id, status: 'AWAITING_DECISION' },
			data: { status: 'IN_PROGRESS', currentAttempt: nextAttempt },
		});
		if (claimed.count !== 1) throw new ExamError(409, 'Already decided.');
		await tx.examAttempt.create({
			data: {
				sessionId: session.id,
				attemptNumber: nextAttempt,
				answers: carried as Prisma.InputJsonValue,
			},
		});
	});
	return { status: 'IN_PROGRESS' as const };
}

// ---------------------------------------------------------------------------
// Results (answer history) and grading
// ---------------------------------------------------------------------------

function buildResult(exam: LoadedExam, session: LoadedSession): ExamResult {
	const submitted = session.attempts.filter((a) => a.submittedAt);
	const finalAttempt = submitted[submitted.length - 1];
	const finalAnswers = asAnswers(finalAttempt?.answers);
	const writtenScores = (session.writtenScores && typeof session.writtenScores === 'object'
		? session.writtenScores
		: {}) as Record<string, number>;

	const questions: ExamResultQuestion[] = exam.questions.map((q) => {
		const type = q.type === 'WRITTEN' ? 'WRITTEN' : 'MCQ';
		const picks = submitted.map((attempt) => {
			const choice = asAnswers(attempt.answers)[q.id]?.choice;
			return { attemptNumber: attempt.attemptNumber, choice: typeof choice === 'number' ? choice : null };
		});
		const finalChoice = finalAnswers[q.id]?.choice;
		return {
			id: q.id,
			position: q.position,
			type,
			text: q.text,
			imageUrl: q.imageUrl,
			choices: choicesOf(q),
			points: q.points,
			correctChoice: type === 'MCQ' ? q.correctChoice : null,
			picks: type === 'MCQ' ? picks : [],
			isCorrect: type === 'MCQ' ? typeof finalChoice === 'number' && finalChoice === q.correctChoice : null,
			written: type === 'WRITTEN' ? (finalAnswers[q.id] ?? null) : null,
			writtenScore: type === 'WRITTEN' && session.writtenStatus === 'GRADED' ? (writtenScores[q.id] ?? null) : null,
		};
	});

	return {
		examId: exam.id,
		title: exam.title,
		attemptsUsed: submitted.length,
		maxAttempts: maxAttemptsOf(exam.maxAttempts),
		mcqScore: session.mcqScore ?? 0,
		mcqTotal: session.mcqTotal ?? 0,
		writtenStatus: session.writtenStatus as WrittenStatus,
		writtenScore: session.writtenScore,
		writtenTotal: exam.questions.filter((q) => q.type === 'WRITTEN').reduce((sum, q) => sum + q.points, 0),
		reviewNote: session.reviewNote,
		finalizedAt: session.finalizedAt?.toISOString() ?? null,
		questions,
	};
}

/** Answer history. Only available once the student has chosen to see the final mark. */
export async function getResult(actor: ExamActor, examId: string): Promise<ExamResult> {
	const exam = await loadPublishedExam(examId);
	const session = await loadSession(examId, actor.userId);
	if (!session) throw new ExamError(404, 'You have not taken this exam.');
	if (session.status !== 'FINALIZED') throw new ExamError(409, 'Your final mark is not available yet.');
	return buildResult(exam, session);
}

export async function getGrading(examId: string): Promise<GradingPayload> {
	const exam = await db.exam.findUnique({
		where: { id: examId },
		include: { questions: { orderBy: { position: 'asc' } } },
	});
	if (!exam) throw new ExamError(404, 'Exam not found.');

	const written = exam.questions.filter((q) => q.type === 'WRITTEN');
	const sessions = await db.examSession.findMany({
		where: { examId, status: 'FINALIZED', writtenStatus: { in: ['UNDER_CORRECTION', 'GRADED'] } },
		include: { user: { select: { name: true, email: true } }, attempts: { orderBy: { attemptNumber: 'asc' } } },
		orderBy: { finalizedAt: 'asc' },
	});

	return {
		exam: { id: exam.id, title: exam.title },
		writtenQuestions: written.map((q) => ({
			id: q.id,
			position: q.position,
			text: q.text,
			imageUrl: q.imageUrl,
			points: q.points,
		})),
		entries: sessions
			.map((session) => {
				const submitted = session.attempts.filter((a) => a.submittedAt);
				const last = submitted[submitted.length - 1];
				return {
					sessionId: session.id,
					studentName: session.user.name || session.user.email,
					studentEmail: session.user.email,
					writtenStatus: session.writtenStatus as WrittenStatus,
					writtenScore: session.writtenScore,
					writtenScores: (session.writtenScores && typeof session.writtenScores === 'object'
						? session.writtenScores
						: {}) as Record<string, number>,
					reviewNote: session.reviewNote,
					finalizedAt: session.finalizedAt?.toISOString() ?? null,
					mcqScore: session.mcqScore ?? 0,
					mcqTotal: session.mcqTotal ?? 0,
					answers: asAnswers(last?.answers),
				};
			})
			// Pending work first.
			.sort((a, b) => Number(b.writtenStatus === 'UNDER_CORRECTION') - Number(a.writtenStatus === 'UNDER_CORRECTION')),
	};
}

export async function gradeSession(
	actor: ExamActor,
	examId: string,
	sessionId: string,
	body: unknown
) {
	const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const exam = await db.exam.findUnique({
		where: { id: examId },
		include: { questions: { where: { type: 'WRITTEN' } } },
	});
	if (!exam) throw new ExamError(404, 'Exam not found.');

	const parsed = parseWrittenScores(data.scores, exam.questions.map((q) => ({ id: q.id, points: q.points })));
	if (!parsed.ok) throw new ExamError(400, parsed.error);

	const note =
		typeof data.reviewNote === 'string' && data.reviewNote.trim() ? data.reviewNote.trim().slice(0, 4000) : null;

	const updated = await db.examSession.updateMany({
		where: { id: sessionId, examId, status: 'FINALIZED', writtenStatus: { in: ['UNDER_CORRECTION', 'GRADED'] } },
		data: {
			writtenStatus: 'GRADED',
			writtenScore: parsed.total,
			writtenScores: parsed.scores,
			reviewNote: note,
			gradedBy: actor.userId,
			gradedAt: new Date(),
		},
	});
	if (!updated.count) throw new ExamError(404, 'Submission not found.');
	return { writtenScore: parsed.total };
}
