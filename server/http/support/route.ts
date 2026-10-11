import 'server-only';

import { createTicket, listTickets, requireSupportActor } from '@/server/services/support';
import { readJson, respond } from '@/server/http/support/respond';

/** Users see their own tickets; admins see every ticket (optionally filtered by ?status=). */
export async function GET(req: Request) {
	return respond('GET support', async () => {
		const actor = await requireSupportActor();
		const status = new URL(req.url).searchParams.get('status');
		return listTickets(actor, status);
	});
}

/** Creates an empty ticket from the subject only. Identity comes from the signed-in session. */
export async function POST(req: Request) {
	return respond('POST support', async () => {
		const actor = await requireSupportActor();
		return createTicket(actor, await readJson(req));
	});
}
