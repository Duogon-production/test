-- Support ticket conversations. Apply with `npx prisma db push` (preferred) or run this SQL manually.
CREATE TABLE IF NOT EXISTS "SupportConversation" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "studentName" TEXT NOT NULL,
  "studentEmail" TEXT NOT NULL,
  "studentAvatarUrl" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportConversation_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'RESOLVED'))
);
CREATE INDEX IF NOT EXISTS "SupportConversation_userId_lastMessageAt_idx" ON "SupportConversation"("userId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "SupportConversation_status_lastMessageAt_idx" ON "SupportConversation"("status", "lastMessageAt");

CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "SupportConversation"("id") ON DELETE CASCADE,
  "senderId" TEXT NOT NULL,
  "senderRole" TEXT NOT NULL,
  "senderName" TEXT NOT NULL,
  "senderAvatarUrl" TEXT,
  "body" TEXT NOT NULL DEFAULT '',
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");
