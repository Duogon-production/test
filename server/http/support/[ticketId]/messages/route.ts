import 'server-only';

import { postMessage, requireSupportActor } from '@/server/services/support';
import { readJson, respond, type TicketParams } from '@/server/http/support/respond';

export async function POST(req: Request, { params }: TicketParams) {
	return respond('POST support message', async () => {
		const { ticketId } = await params;
		const actor = await requireSupportActor();
		return postMessage(actor, ticketId, await readJson(req));
	});
}
