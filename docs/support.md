# Support tab (ticket chat)

- **Pages**: `/support` (dashboard + new-ticket modal + messenger chat). Sidebar, header and footer "Support" buttons go here.
- **Identity**: name, email and avatar are read from the signed-in session on the server (`requireSupportActor`). There are no name/email inputs.
- **Routing**: every ticket goes to website admins (`role = ADMIN`). Admins see all tickets, reply, and set status. Students see only their own.
  Curriculum questions are NOT handled here — the footer keeps the teacher's WhatsApp/phone links.
- **Flow**: New Ticket -> modal asks for Subject only (preset list + "Other" reveals a custom field) -> `POST /api/support` creates an empty ticket -> user lands in the chat and writes the first message with optional screenshots/PDFs (UploadThing `supportAttachment`, up to 5 per message, 16 MB each).
- **Statuses**: Open -> In Progress (first admin reply) -> Resolved (admin sets). A student replying to a Resolved ticket reopens it.
- **Email**: new student messages email the admins (best effort, needs `RESEND_API_KEY`). Recipients: `SUPPORT_EMAIL_TO` (comma separated), default = the two original support inboxes.
- **Database**: `SupportConversation`, `SupportMessage`. Run `npx prisma db push` or `prisma/manual-migrations/20261012_support_conversations.sql` (exams SQL `20261011_exams.sql` first if not applied).
- **API**: `GET/POST /api/support`, `GET/PATCH /api/support/:ticketId`, `POST /api/support/:ticketId/messages`.
