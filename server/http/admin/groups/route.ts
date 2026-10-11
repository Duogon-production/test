import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { db } from '@/server/db';
import { isAdminOrTeacher } from '@/server/services/teacher';

const WEEKDAY_NAMES = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
];

/** Validates and normalizes the schedule payload ({ day, time: 'HH:mm' }[]). Returns null if invalid. */
const normalizeSchedule = (input: unknown) => {
	if (!Array.isArray(input)) return null;
	const result: { day: string; time: string }[] = [];
	for (const item of input) {
		if (!item || typeof item !== 'object') return null;
		const rawDay = String((item as { day?: unknown }).day ?? '').trim();
		const rawTime = String((item as { time?: unknown }).time ?? '').trim();
		const day = WEEKDAY_NAMES.find(
			(d) => d.toLowerCase() === rawDay.toLowerCase()
		);
		// Accept "HH:mm" or "HH:mm:ss" (browser time inputs may emit seconds)
		const match = rawTime.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
		if (!day || !match) return null;
		const hour = Number(match[1]);
		const minute = Number(match[2]);
		if (hour > 23 || minute > 59) return null;
		result.push({
			day,
			time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
		});
	}
	return result;
};

const requireStaffAccess = async () => {
	const { userId, sessionClaims } = await auth();
	return isAdminOrTeacher(userId, sessionClaims);
};

export async function GET() {
	if (!(await requireStaffAccess())) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	try {
		const groups = await db.group.findMany({
			orderBy: { createdAt: 'desc' },
			include: {
				students: {
					include: {
						user: {
							select: {
								id: true,
								externalId: true,
								name: true,
								email: true,
								role: true,
								isApproved: true,
							},
						},
					},
				},
			},
		});

		const enrichedGroups = groups.map((g) => ({
			id: g.id,
			name: g.name,
			schedule: g.schedule,
			createdAt: g.createdAt,
			updatedAt: g.updatedAt,
			students: g.students.map((s) => ({
				id: s.id,
				userId: s.userId,
				groupId: s.groupId,
				user: {
					id: s.user?.id || s.userId,
					externalId: s.user?.externalId || s.userId,
					name: s.user?.name || 'Student',
					email: s.user?.email || '',
					imageUrl: '',
					role: s.user?.role?.toLowerCase() || 'student',
				},
			})),
		}));

		return NextResponse.json(enrichedGroups);
	} catch (error) {
		console.error('[GROUPS_GET]', error);
		return new NextResponse('Unable to load study groups.', { status: 500 });
	}
}

export async function POST(req: Request) {
	if (!(await requireStaffAccess())) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	try {
		const body = await req.json();
		const name = typeof body?.name === 'string' ? body.name.trim() : '';
		const schedule = normalizeSchedule(body?.schedule ?? []);

		if (!name) {
			return new NextResponse('A group name is required.', { status: 400 });
		}
		if (!schedule) {
			return new NextResponse(
				'Schedule sessions need a valid weekday and HH:mm time.',
				{ status: 400 }
			);
		}

		const existing = await db.group.findUnique({
			where: { name },
		});
		if (existing) {
			return new NextResponse('A group with this name already exists.', {
				status: 409,
			});
		}

		const group = await db.group.create({
			data: {
				name,
				schedule,
			},
		});

		return NextResponse.json(group, { status: 201 });
	} catch (error) {
		console.error('[GROUPS_POST]', error);
		return new NextResponse('Unable to create the study group.', { status: 500 });
	}
}

export async function PATCH(req: Request) {
	if (!(await requireStaffAccess())) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	try {
		const body = await req.json();
		const id = typeof body?.id === 'string' ? body.id.trim() : '';
		const name = typeof body?.name === 'string' ? body.name.trim() : '';

		if (!id) {
			return new NextResponse('A group id is required.', { status: 400 });
		}
		if (!name) {
			return new NextResponse('A group name is required.', { status: 400 });
		}

		const schedule = normalizeSchedule(body?.schedule);
		if (!schedule || schedule.length === 0) {
			return new NextResponse(
				'Provide at least one valid session (weekday and HH:mm time).',
				{ status: 400 }
			);
		}

		const group = await db.group.findUnique({ where: { id } });
		if (!group) {
			return new NextResponse('Group not found.', { status: 404 });
		}

		// Name is unique: reject collisions with a *different* group
		const duplicate = await db.group.findFirst({
			where: { name, NOT: { id } },
			select: { id: true },
		});
		if (duplicate) {
			return new NextResponse('A group with this name already exists.', {
				status: 409,
			});
		}

		const updated = await db.group.update({
			where: { id },
			data: { name, schedule },
		});

		return NextResponse.json(updated);
	} catch (error) {
		console.error('[GROUPS_PATCH]', error);
		const code = (error as { code?: string })?.code;
		if (code === 'P2002') {
			return new NextResponse('A group with this name already exists.', {
				status: 409,
			});
		}
		if (code === 'P2025') {
			return new NextResponse('Group not found.', { status: 404 });
		}
		return new NextResponse('Unable to update the study group.', {
			status: 500,
		});
	}
}

export async function PUT(req: Request) {
	if (!(await requireStaffAccess())) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	try {
		const body = await req.json();
		const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
		const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : '';

		if (!userId || !groupId) {
			return new NextResponse('A userId and groupId are required.', {
				status: 400,
			});
		}

		const group = await db.group.findUnique({
			where: { id: groupId },
		});
		if (!group) {
			return new NextResponse('Group not found.', { status: 404 });
		}

		// Resolve student from Prisma
		const targetUser = await db.user.findFirst({
			where: {
				OR: [{ id: userId }, { externalId: userId }],
			},
		});

		if (!targetUser) {
			return new NextResponse('Student not found in database.', { status: 404 });
		}

		const membership = await db.$transaction(async (tx) => {
			await tx.userGroup.deleteMany({ where: { userId: targetUser.id } });
			return tx.userGroup.create({
				data: {
					userId: targetUser.id,
					groupId: group.id,
				},
			});
		});

		return NextResponse.json(membership);
	} catch (error) {
		console.error('[GROUPS_ASSIGN]', error);
		return new NextResponse('Unable to assign the student to this group.', {
			status: 500,
		});
	}
}

export async function DELETE(req: Request) {
	if (!(await requireStaffAccess())) {
		return new NextResponse('Unauthorized', { status: 401 });
	}

	try {
		const { searchParams } = new URL(req.url);
		const groupId = searchParams.get('groupId')?.trim();
		const unassignUserId = searchParams.get('unassignUserId')?.trim();

		// Case 1: Unassign student from group
		if (unassignUserId) {
			const targetUser = await db.user.findFirst({
				where: {
					OR: [{ id: unassignUserId }, { externalId: unassignUserId }],
				},
			});
			if (targetUser) {
				await db.userGroup.deleteMany({ where: { userId: targetUser.id } });
			}
			return NextResponse.json({ success: true });
		}

		// Case 2: Delete entire group
		if (!groupId) {
			return new NextResponse('A groupId or unassignUserId is required.', {
				status: 400,
			});
		}

		await db.group.delete({
			where: { id: groupId },
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('[GROUPS_DELETE]', error);
		return new NextResponse('Unable to delete this group or unassign student.', {
			status: 500,
		});
	}
}
