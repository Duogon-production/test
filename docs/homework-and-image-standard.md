# Homework review notes, question builder, and image URL standard

## Database (run `npx prisma db push`, or `prisma/manual-migrations/20261011_homework_notes_and_questions.sql`)
- `HomeworkSubmission.reviewNote`, `reviewedAt`: optional teacher/admin feedback.
- `Chapter.homeworkMode`: `FILE_UPLOAD` (default) or `PLATFORM_QUESTIONS`.
- `HomeworkQuestion`: per-segment questions (`text` required; `imageUrl`, `answer`, `answerImageUrl` optional).

## Behaviour
- Admin review dialog: optional note; "Save note only" or "Approve with note". Plain 1-tap approve still works.
  A student's replacement upload clears the old note. Students see the note on the homework segment.
- Teacher segment editor (homework type): choose File upload or Platform questions. Questions save as one list
  (`PUT /api/courses/:courseId/chapters/:chapterId/homework-questions`). Students still submit a file in both modes;
  answers are only sent to a student after they submit.
- Image standard: images are http(s) URLs (`shared/image-url.ts`, validated server-side). Course covers use a URL field;
  the `courseImage` upload route and image uploads on `courseAttachment` were removed. Only `homeworkSubmission`
  uploads files. Site assets are configured in `shared/constants/assets.ts` (env: `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_TEXTBOOK_TEMPLATE_URL`).
