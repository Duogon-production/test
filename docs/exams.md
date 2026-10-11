# Exams (`/exams`)

Multi-attempt exams with auto-graded multiple choice, written/handwritten answers, and a visual answer history.

## Setup

Apply the schema once: `npx prisma db push` (or run `prisma/manual-migrations/20261011_exams.sql`).
The `examAnswerImage` UploadThing route is used for handwritten photo answers.

## Rules

- **Admin/teacher** sets per exam: duration (1–1440 min, or unlimited), max attempts (1 or 2), published state.
  Once any student has started, questions, duration and attempts are locked (title, description and published stay editable).
- **Attempt 1 with `maxAttempts = 2`**: if any MCQ is wrong or unanswered, the student sees
  "You have incorrect answers. Would you like to view your final mark now or take your 2nd attempt to solve again?"
  No score or per-question correctness is sent to the browser at this point.
- **Auto-submit as final** when `maxAttempts = 1`, on the last allowed attempt, or when every MCQ is correct.
- **Final mark** = the last submitted attempt. Choosing "view final mark" keeps attempt 1; retrying replaces it.
  (Change `buildResult`/`finalizeData` in `server/services/exams.ts` if you prefer best-of-two.)
- **Timer** is enforced on the server (per attempt, with a 20 s grace). Answers autosave; an expired attempt is
  submitted from the last autosaved draft.
- **Written questions** accept text and/or one handwritten photo. MCQs are graded immediately; the written part is
  `UNDER_CORRECTION` until a teacher/admin enters marks under *Exams → Written answers*.
- **Answer history** (only after finalising): correct choice green, the student's wrong picks red, with per-choice
  `1st Try` / `2nd Try` badges and a summary line such as `1st Try: Choice D · 2nd Try: Choice C`.

## Code map

`shared/exams.ts` (rules, validation, scoring) · `server/services/exams.ts` (lifecycle) ·
`server/http/exams/**` + `app/api/exams/**` (API) · `frontend/features/exams/**` (UI) ·
`app/(dashboard)/(routes)/exams/**` (pages) · tests in `scripts/exams.test.cjs`.
