import 'server-only';

import { getTicket, requireSupportActor, setStatus } from '@/server/services/support';
import { readJson, respond, type TicketParams } from '@/server/http/support/respond';

export async function GET(_req: Request, { params }: TicketParams) {
	return respond('GET support ticket', async () => {
		const { ticketId } = await params;
		return getTicket(await requireSupportActor(), ticketId);
	});
}

export async function PATCH(req: Request, { params }: TicketParams) {
	return respond('PATCH support ticket', async () => {
		const { ticketId } = await params;
		const actor = await requireSupportActor();
		const body = (await readJson(req)) as { status?: unknown };
		return setStatus(actor, ticketId, body.status);
	});
}
