import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { Resend } from 'resend';

import { db } from '@/server/db';
import { getDbUser } from '@/server/services/user';
import type {
	SupportListPayload,
	SupportMessageView,
	SupportTicketDetail,
	SupportTicketSummary,
} from '@/shared/contracts/support';
import {
	isTicketStatus,
	parseMessage,
	parseSubject,
	type SupportAttachment,
	type TicketStatus,
} from '@/shared/support';

export class SupportError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface SupportActor {
	/** Database user id. */
	userId: string;
	/** Name, email and avatar come from the authenticated session. */
	name: string;
	email: string;
	avatarUrl: string | null;
	/** Only website admins receive and answer tickets. */
	isAdmin: boolean;
}

export async function requireSupportActor(): Promise<SupportActor> {
	const { userId } = await auth();
	if (!userId) throw new SupportError(401, 'Unauthorized');
	const user = await getDbUser(userId);
	if (!user) throw new SupportError(404, 'User not found in system.');

	// Avatar lives in Clerk only; fall back silently if it can't be read.
	let clerkName = '';
	let avatarUrl: string | null = null;
	try {
		const clerk = await currentUser();
		avatarUrl = clerk?.imageUrl ?? null;
		clerkName = [clerk?.firstName, clerk?.lastName].filter(Boolean).join(' ').trim() || clerk?.username || '';
	} catch (error) {
		console.error('[SUPPORT_CLERK_USER]', error);
	}

	return {
		userId: user.id,
		name: user.name || clerkName || user.email,
		email: user.email,
		avatarUrl,
		isAdmin: user.role === 'ADMIN',
	};
}

type ConversationRow = Prisma.SupportConversationGetPayload<object>;

const toSummary = (
	row: ConversationRow,
	extra: { count: number; preview: string | null }
): SupportTicketSummary => ({
	id: row.id,
	subject: row.subject,
	status: isTicketStatus(row.status) ? row.status : 'OPEN',
	studentName: row.studentName,
	studentEmail: row.studentEmail,
	studentAvatarUrl: row.studentAvatarUrl,
	lastMessagePreview: extra.preview,
	messageCount: extra.count,
	createdAt: row.createdAt.toISOString(),
	lastMessageAt: row.lastMessageAt.toISOString(),
});

const previewOf = (body: string, attachments: unknown) => {
	if (body.trim()) return body.trim().slice(0, 120);
	return Array.isArray(attachments) && attachments.length ? 'Sent an attachment' : null;
};

export async function listTickets(actor: SupportActor, status?: string | null): Promise<SupportListPayload> {
	const rows = await db.supportConversation.findMany({
		where: {
			...(actor.isAdmin ? {} : { userId: actor.userId }),
			...(isTicketStatus(status) ? { status } : {}),
		},
		orderBy: { lastMessageAt: 'desc' },
		take: 200,
		include: {
			_count: { select: { messages: true } },
			messages: { orderBy: { createdAt: 'desc' }, take: 1 },
		},
	});
	return {
		viewerIsAdmin: actor.isAdmin,
		tickets: rows.map((row) =>
			toSummary(row, {
				count: row._count.messages,
				preview: row.messages[0] ? previewOf(row.messages[0].body, row.messages[0].attachments) : null,
			})
		),
	};
}

export async function createTicket(actor: SupportActor, body: unknown): Promise<SupportTicketDetail> {
	const parsed = parseSubject(body);
	if (!parsed.ok) throw new SupportError(400, parsed.error);
	const row = await db.supportConversation.create({
		data: {
			userId: actor.userId,
			subject: parsed.subject,
			studentName: actor.name,
			studentEmail: actor.email,
			studentAvatarUrl: actor.avatarUrl,
		},
	});
	return {
		ticket: toSummary(row, { count: 0, preview: null }),
		messages: [],
		viewerIsAdmin: actor.isAdmin,
	};
}

async function loadAccessible(actor: SupportActor, ticketId: string) {
	const row = await db.supportConversation.findUnique({ where: { id: ticketId } });
	// Not-found for other people's tickets, so ids can't be probed.
	if (!row || (!actor.isAdmin && row.userId !== actor.userId)) {
		throw new SupportError(404, 'Ticket not found.');
	}
	return row;
}

const toMessageView = (
	row: Prisma.SupportMessageGetPayload<object>,
	actor: SupportActor
): SupportMessageView => ({
	id: row.id,
	senderName: row.senderName,
	senderAvatarUrl: row.senderAvatarUrl,
	senderRole: row.senderRole === 'ADMIN' ? 'ADMIN' : 'STUDENT',
	isMine: row.senderId === actor.userId,
	body: row.body,
	attachments: Array.isArray(row.attachments) ? (row.attachments as unknown as SupportAttachment[]) : [],
	createdAt: row.createdAt.toISOString(),
});

export async function getTicket(actor: SupportActor, ticketId: string): Promise<SupportTicketDetail> {
	const row = await loadAccessible(actor, ticketId);
	const messages = await db.supportMessage.findMany({
		where: { conversationId: ticketId },
		orderBy: { createdAt: 'asc' },
		take: 500,
	});
	const last = messages[messages.length - 1];
	return {
		ticket: toSummary(row, {
			count: messages.length,
			preview: last ? previewOf(last.body, last.attachments) : null,
		}),
		messages: messages.map((m) => toMessageView(m, actor)),
		viewerIsAdmin: actor.isAdmin,
	};
}

export async function postMessage(actor: SupportActor, ticketId: string, body: unknown): Promise<SupportMessageView> {
	const parsed = parseMessage(body);
	if (!parsed.ok) throw new SupportError(400, parsed.error);
	const ticket = await loadAccessible(actor, ticketId);

	// Admin replies move an untouched ticket to In Progress; a student writing again reopens a resolved one.
	let nextStatus: TicketStatus | null = null;
	if (actor.isAdmin && ticket.status === 'OPEN') nextStatus = 'IN_PROGRESS';
	if (!actor.isAdmin && ticket.status === 'RESOLVED') nextStatus = 'OPEN';

	const now = new Date();
	const [message] = await db.$transaction([
		db.supportMessage.create({
			data: {
				conversationId: ticketId,
				senderId: actor.userId,
				senderRole: actor.isAdmin ? 'ADMIN' : 'STUDENT',
				senderName: actor.name,
				senderAvatarUrl: actor.avatarUrl,
				body: parsed.text,
				attachments: parsed.attachments as unknown as Prisma.InputJsonValue,
				createdAt: now,
			},
		}),
		db.supportConversation.update({
			where: { id: ticketId },
			data: {
				lastMessageAt: now,
				...(nextStatus ? { status: nextStatus } : {}),
				// Keep the student's snapshot fresh when they write.
				...(!actor.isAdmin ? { studentName: actor.name, studentAvatarUrl: actor.avatarUrl } : {}),
			},
		}),
	]);

	if (!actor.isAdmin) void notifyAdmins(ticket.subject, actor, parsed.text, parsed.attachments.length);
	return toMessageView(message, actor);
}

export async function setStatus(actor: SupportActor, ticketId: string, status: unknown) {
	if (!actor.isAdmin) throw new SupportError(403, 'Only admins can change ticket status.');
	if (!isTicketStatus(status)) throw new SupportError(400, 'Invalid status.');
	const result = await db.supportConversation.updateMany({ where: { id: ticketId }, data: { status } });
	if (!result.count) throw new SupportError(404, 'Ticket not found.');
	return { status };
}

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Best-effort email to the admins. Never blocks or fails the chat. */
async function notifyAdmins(subject: string, actor: SupportActor, text: string, attachmentCount: number) {
	try {
		if (!process.env.RESEND_API_KEY) return;
		// Same default inboxes the original Website Help form used; override with SUPPORT_EMAIL_TO.
		const recipients = (process.env.SUPPORT_EMAIL_TO || 'support.lop.physics@gmail.com,bodyahmedyehia902@gmail.com')
			.split(',')
			.map((address) => address.trim())
			.filter(Boolean);
		if (!recipients.length) return;
		const resend = new Resend(process.env.RESEND_API_KEY);
		await resend.emails.send({
			from: 'EduLabs Support <onboarding@resend.dev>',
			to: recipients,
			subject: `[Support] ${subject}`,
			html: `<div style="font-family:sans-serif;max-width:600px">
<p><strong>${escapeHtml(actor.name)}</strong> (${escapeHtml(actor.email)}) wrote in a support ticket:</p>
<p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">${escapeHtml(text || '(no text)')}</p>
${attachmentCount ? `<p>${attachmentCount} attachment(s) — open the Support page to view.</p>` : ''}
<p>Reply from the Support tab in the portal.</p></div>`,
		});
	} catch (error) {
		console.error('[SUPPORT_NOTIFY_ADMINS]', error);
	}
}
