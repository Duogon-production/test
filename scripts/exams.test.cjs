const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Runs the real exam logic against an in-memory database: no credentials, no writes.
function load(filename, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console: { log() {}, error() {} }, Date, Math, Number, Object, Array, JSON, String, Error,
    require(name) {
      if (name === 'server-only') return {};
      assert(Object.hasOwn(dependencies, name), `Unmocked dependency ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const imageUrl = load('shared/image-url.ts', {});
const shared = load('shared/exams.ts', { '@/shared/image-url': imageUrl });

test('sanitizeAnswers keeps only valid answers for real questions', () => {
  const questions = [
    { id: 'm', type: 'MCQ', choiceCount: 4, correctChoice: 1, points: 1 },
    { id: 'w', type: 'WRITTEN', correctChoice: null, points: 5 },
  ];
  const clean = shared.sanitizeAnswers({
    m: { choice: 9 }, w: { text: '  hello ', imageUrl: 'javascript:alert(1)' }, ghost: { choice: 1 },
  }, questions);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), { w: { text: 'hello', imageUrl: null, imageKey: null } });
  assert.equal(shared.sanitizeAnswers({ m: { choice: 3 } }, questions).m.choice, 3);
});

test('scoreMcq treats unanswered as a mistake and reports perfect scores', () => {
  const qs = [
    { id: 'a', type: 'MCQ', correctChoice: 0, points: 2 },
    { id: 'b', type: 'MCQ', correctChoice: 1, points: 1 },
    { id: 'w', type: 'WRITTEN', correctChoice: null, points: 5 },
  ];
  const partial = shared.scoreMcq(qs, { a: { choice: 0 } });
  assert.equal(partial.score, 2); assert.equal(partial.total, 3); assert.equal(partial.hasMistakes, true);
  const perfect = shared.scoreMcq(qs, { a: { choice: 0 }, b: { choice: 1 } });
  assert.equal(perfect.hasMistakes, false);
});

test('shouldAutoFinalize follows the retry rules', () => {
  const f = shared.shouldAutoFinalize;
  assert.equal(f({ maxAttempts: 1, attemptNumber: 1, hasMistakes: true }), true);
  assert.equal(f({ maxAttempts: 2, attemptNumber: 1, hasMistakes: false }), true);
  assert.equal(f({ maxAttempts: 2, attemptNumber: 1, hasMistakes: true }), false);
  assert.equal(f({ maxAttempts: 2, attemptNumber: 2, hasMistakes: true }), true);
});

test('parseExamInput enforces duration, attempts and question rules', () => {
  const mcq = { type: 'MCQ', text: 'Q', choices: ['a', 'b'], correctChoice: 0 };
  const base = { title: 'T', durationMinutes: 1, maxAttempts: 2, questions: [mcq] };
  assert.equal(shared.parseExamInput(base).ok, true);
  assert.equal(shared.parseExamInput({ ...base, durationMinutes: null }).ok, true);
  assert.equal(shared.parseExamInput({ ...base, durationMinutes: 0 }).ok, false);
  assert.equal(shared.parseExamInput({ ...base, maxAttempts: 3 }).ok, false);
  assert.equal(shared.parseExamInput({ ...base, questions: [{ ...mcq, correctChoice: 5 }] }).ok, false);
  assert.equal(shared.parseExamInput({ ...base, questions: [] }).ok, false);
  assert.equal(shared.parseExamInput({ ...base, questions: [{ type: 'WRITTEN', text: 'Explain', points: 4 }] }).ok, true);
});

// ---- in-memory Prisma fake -------------------------------------------------
function fakeDb(exam) {
  const sessions = []; const attempts = []; let n = 0;
  const id = () => `id${++n}`;
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && !(v instanceof Date)) return true;
    return row[k] === v;
  });
  const withAttempts = (s) => s && { ...s, attempts: attempts.filter((a) => a.sessionId === s.id).sort((a, b) => a.attemptNumber - b.attemptNumber).map((a) => ({ ...a })) };
  const db = {
    exam: {
      findFirst: async () => ({ ...exam, questions: exam.questions.map((q) => ({ ...q })) }),
      findUnique: async (args = {}) => {
        const only = args.include && args.include.questions && args.include.questions.where;
        const rows = exam.questions.filter((q) => !only || q.type === only.type);
        return { ...exam, questions: rows.map((q) => ({ ...q })) };
      },
    },
    examSession: {
      findUnique: async ({ where }) => withAttempts(sessions.find((s) => s.examId === where.examId_userId.examId && s.userId === where.examId_userId.userId)),
      create: async ({ data }) => {
        const s = { id: id(), examId: data.examId, userId: data.userId, status: 'IN_PROGRESS', currentAttempt: 1, finalizedAt: null,
          mcqScore: null, mcqTotal: null, writtenStatus: 'NONE', writtenScore: null, writtenScores: null, reviewNote: null };
        sessions.push(s);
        attempts.push({ id: id(), sessionId: s.id, attemptNumber: 1, startedAt: new Date(), submittedAt: null, answers: {}, mcqScore: null });
        return s;
      },
      update: async ({ where, data }) => Object.assign(sessions.find((s) => s.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = sessions.filter((s) => match(s, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      },
    },
    examAttempt: {
      update: async ({ where, data }) => Object.assign(attempts.find((a) => a.sessionId === where.sessionId_attemptNumber.sessionId && a.attemptNumber === where.sessionId_attemptNumber.attemptNumber), data),
      updateMany: async ({ where, data }) => {
        const rows = attempts.filter((a) => a.id === where.id && (!('submittedAt' in where) || a.submittedAt === where.submittedAt));
        rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      },
      create: async ({ data }) => { const a = { id: id(), startedAt: new Date(), submittedAt: null, mcqScore: null, ...data }; attempts.push(a); return a; },
    },
  };
  db.$transaction = async (fn) => fn(db);
  return { db, sessions, attempts };
}

function service(exam) {
  const fake = fakeDb(exam);
  const svc = load('server/services/exams.ts', {
    '@clerk/nextjs/server': { auth: async () => ({}) },
    '@prisma/client': { Prisma: { PrismaClientKnownRequestError: class extends Error {}, JsonNull: null } },
    '@/server/db': { db: fake.db },
    '@/server/services/teacher': { isAdminOrTeacher: async () => false },
    '@/server/services/user': { getDbUser: async () => null },
    '@/shared/exams': shared,
    '@/shared/contracts/exams': {},
  });
  return { svc, ...fake };
}

const baseExam = (over = {}) => ({
  id: 'e1', title: 'Exam', description: null, durationMinutes: null, maxAttempts: 2, isPublished: true,
  questions: [
    { id: 'q1', position: 1, type: 'MCQ', text: 'Q1', imageUrl: null, choices: ['a', 'b', 'c', 'd'], correctChoice: 2, points: 1 },
    { id: 'q2', position: 2, type: 'MCQ', text: 'Q2', imageUrl: null, choices: ['a', 'b', 'c', 'd'], correctChoice: 1, points: 1 },
    { id: 'w1', position: 3, type: 'WRITTEN', text: 'Explain', imageUrl: null, choices: null, correctChoice: null, points: 4 },
  ],
  ...over,
});
const student = { userId: 'u1', name: 'Sam', isStaff: false };

test('attempt 1 with mistakes asks to retry without revealing which answers are wrong', async () => {
  const { svc } = service(baseExam());
  await svc.startExam(student, 'e1');
  const out = await svc.submitAttempt(student, 'e1', { q1: { choice: 0 }, q2: { choice: 1 }, w1: { text: 'because' } });
  assert.deepEqual({ ...out }, { status: 'AWAITING_DECISION' });
  const state = await svc.getRunState(student, 'e1');
  assert.equal(state.status, 'AWAITING_DECISION');
  assert.deepEqual(Array.from(state.questions), []);
  await assert.rejects(svc.getResult(student, 'e1'), (e) => e.status === 409);
});

test('retry then final submit builds the per-choice attempt history', async () => {
  const { svc } = service(baseExam());
  await svc.startExam(student, 'e1');
  await svc.submitAttempt(student, 'e1', { q1: { choice: 3 }, q2: { choice: 1 }, w1: { text: 'draft' } });
  await svc.decide(student, 'e1', 'RETRY');
  const retry = await svc.getRunState(student, 'e1');
  assert.equal(retry.attemptNumber, 2);
  assert.equal(retry.answers.q1, undefined);        // MCQs start blank
  assert.equal(retry.answers.w1.text, 'draft');     // written answer carried over
  const out = await svc.submitAttempt(student, 'e1', { q1: { choice: 2 }, q2: { choice: 0 }, w1: { text: 'final' } });
  assert.equal(out.status, 'FINALIZED');             // last allowed attempt
  const result = await svc.getResult(student, 'e1');
  const q1 = result.questions.find((q) => q.id === 'q1');
  assert.deepEqual(q1.picks.map((p) => [p.attemptNumber, p.choice]), [[1, 3], [2, 2]]);
  assert.equal(q1.correctChoice, 2); assert.equal(q1.isCorrect, true);
  const q2 = result.questions.find((q) => q.id === 'q2');
  assert.deepEqual(q2.picks.map((p) => p.choice), [1, 0]); assert.equal(q2.isCorrect, false);
  assert.equal(result.mcqScore, 1); assert.equal(result.mcqTotal, 2);
  assert.equal(result.writtenStatus, 'UNDER_CORRECTION');
  assert.equal(result.questions.find((q) => q.id === 'w1').written.text, 'final');
});

test('single-attempt exams and perfect MCQ scores finalise immediately', async () => {
  const one = service(baseExam({ maxAttempts: 1 }));
  await one.svc.startExam(student, 'e1');
  assert.equal((await one.svc.submitAttempt(student, 'e1', { q1: { choice: 0 } })).status, 'FINALIZED');

  const perfect = service(baseExam());
  await perfect.svc.startExam(student, 'e1');
  assert.equal((await perfect.svc.submitAttempt(student, 'e1', { q1: { choice: 2 }, q2: { choice: 1 } })).status, 'FINALIZED');
});

test('choosing to view the final mark keeps attempt 1 as final', async () => {
  const { svc } = service(baseExam());
  await svc.startExam(student, 'e1');
  await svc.submitAttempt(student, 'e1', { q1: { choice: 0 }, q2: { choice: 1 } });
  assert.deepEqual({ ...(await svc.decide(student, 'e1', 'FINALIZE')) }, { status: 'FINALIZED' });
  const result = await svc.getResult(student, 'e1');
  assert.equal(result.attemptsUsed, 1); assert.equal(result.mcqScore, 1);
  await assert.rejects(svc.decide(student, 'e1', 'RETRY'), (e) => e.status === 409);
});

test('an expired attempt is submitted from the autosaved draft, ignoring late edits', async () => {
  const { svc, attempts } = service(baseExam({ durationMinutes: 1, maxAttempts: 1 }));
  await svc.startExam(student, 'e1');
  await svc.saveDraft(student, 'e1', { q1: { choice: 2 } });
  attempts[0].startedAt = new Date(Date.now() - 10 * 60_000);
  await assert.rejects(svc.saveDraft(student, 'e1', { q2: { choice: 1 } }), (e) => e.status === 409);
  const state = await svc.getRunState(student, 'e1');
  assert.equal(state.status, 'FINALIZED');
  assert.equal((await svc.getResult(student, 'e1')).mcqScore, 1);
});

test('written grading validates marks and moves Under Correction to Graded', async () => {
  const { svc, sessions } = service(baseExam({ maxAttempts: 1 }));
  const staff = { userId: 'admin', name: 'A', isStaff: true };
  await svc.startExam(student, 'e1');
  await svc.submitAttempt(student, 'e1', { q1: { choice: 2 }, q2: { choice: 1 }, w1: { text: 'x' } });
  await assert.rejects(svc.gradeSession(staff, 'e1', sessions[0].id, { scores: { w1: 9 } }), (e) => e.status === 400);
  await svc.gradeSession(staff, 'e1', sessions[0].id, { scores: { w1: 3.5 }, reviewNote: 'good' });
  const result = await svc.getResult(student, 'e1');
  assert.equal(result.writtenStatus, 'GRADED'); assert.equal(result.writtenScore, 3.5);
  assert.equal(result.reviewNote, 'good');
});
