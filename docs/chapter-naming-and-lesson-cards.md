# Chapter naming and lesson cards

## Chapter naming: `[Type] [Number] - [Name]`
- A lesson (the `Course` model) belongs to a chapter group through `chapterType` (default "Chapter") and `chapterNumber` (1-99).
- Admins/teachers set both in the lesson editor ("Chapter" card -> Edit chapter). Type is a preset (Chapter, Month, Unit, Week, Module, Term, Revision) or any custom text.
- The same dialog edits the group's **name**, **short summary** and optional **full description** (`ChapterInfo` table, unique per type + number, shared by all lessons in the group). Examples: "Chapter 1 - Ohm's Law", "Month 2 - Advanced Review".
- The 8 names that used to be hardcoded in `server/queries/self-learning.ts` are now rows in `ChapterInfo` (seeded by the migration) and can be edited.
- API: `GET/PUT /api/chapter-info` (admin/teacher only). `PATCH /api/courses/:id` validates `chapterType` / `chapterNumber`.
- Self-learning page shows the formatted title, the summary under it, and the full description inside the opened chapter.

## Lesson cards (`frontend/features/courses/lesson-card.tsx`)
One component, used by the dashboard "Your Journey" row and the Self-Learning page:
- Top: `Chapter X • Lesson Y` (uses the custom type; lesson number restarts inside each chapter group)
- Title, optional lesson description
- Footer: `X parts` (left) and status/action pill (right): Open Lesson / In Progress / Completed / Locked
- The duplicate "segments" badge is gone. A lesson image becomes the card background under a dark gradient so white text stays readable.

## Database
Run `npx prisma db push`, or `prisma/manual-migrations/20261013_chapter_naming.sql`.
