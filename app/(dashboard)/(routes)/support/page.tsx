import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { SupportView } from '@/frontend/features/support/support-view';

const SupportPage = async () => {
	const { userId } = await auth();
	if (!userId) return redirect('/');
	return <SupportView />;
};

export default SupportPage;
