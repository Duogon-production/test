-- Apply with `npx prisma db push` (preferred) or run this SQL manually.
ALTER TABLE "Chapter" ADD COLUMN IF NOT EXISTS "homeworkMode" TEXT NOT NULL DEFAULT 'FILE_UPLOAD';
ALTER TABLE "HomeworkSubmission" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "HomeworkSubmission" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "HomeworkQuestion" (
  "id" TEXT PRIMARY KEY,
  "chapterId" TEXT NOT NULL REFERENCES "Chapter"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "imageUrl" TEXT,
  "answer" TEXT,
  "answerImageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HomeworkQuestion_chapterId_position_idx" ON "HomeworkQuestion"("chapterId","position");
