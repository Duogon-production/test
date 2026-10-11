-- Multi-attempt exam system. Apply with `npx prisma db push` (preferred) or run this SQL manually.
CREATE TABLE IF NOT EXISTS "Exam" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "isPublished" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Exam_maxAttempts_check" CHECK ("maxAttempts" IN (1, 2)),
  CONSTRAINT "Exam_duration_check" CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 1 AND 1440)
);

CREATE TABLE IF NOT EXISTS "ExamQuestion" (
  "id" TEXT PRIMARY KEY,
  "examId" TEXT NOT NULL REFERENCES "Exam"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'MCQ',
  "text" TEXT NOT NULL,
  "imageUrl" TEXT,
  "choices" JSONB,
  "correctChoice" INTEGER,
  "points" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExamQuestion_examId_position_idx" ON "ExamQuestion"("examId", "position");

CREATE TABLE IF NOT EXISTS "ExamSession" (
  "id" TEXT PRIMARY KEY,
  "examId" TEXT NOT NULL REFERENCES "Exam"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "currentAttempt" INTEGER NOT NULL DEFAULT 1,
  "finalizedAt" TIMESTAMP(3),
  "mcqScore" INTEGER,
  "mcqTotal" INTEGER,
  "writtenStatus" TEXT NOT NULL DEFAULT 'NONE',
  "writtenScore" DOUBLE PRECISION,
  "writtenScores" JSONB,
  "reviewNote" TEXT,
  "gradedBy" TEXT,
  "gradedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExamSession_examId_userId_key" ON "ExamSession"("examId", "userId");
CREATE INDEX IF NOT EXISTS "ExamSession_examId_writtenStatus_idx" ON "ExamSession"("examId", "writtenStatus");
CREATE INDEX IF NOT EXISTS "ExamSession_userId_idx" ON "ExamSession"("userId");

CREATE TABLE IF NOT EXISTS "ExamAttempt" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "ExamSession"("id") ON DELETE CASCADE,
  "attemptNumber" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "answers" JSONB NOT NULL DEFAULT '{}',
  "mcqScore" INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAttempt_sessionId_attemptNumber_key" ON "ExamAttempt"("sessionId", "attemptNumber");
