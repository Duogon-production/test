import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { ExamsView } from '@/frontend/features/exams/exams-view';
import { isAdminOrTeacher } from '@/server/services/teacher';

const ExamsPage = async () => {
	const { userId, sessionClaims } = await auth();
	if (!userId) return redirect('/');

	const isStaff = await isAdminOrTeacher(userId, sessionClaims);
	return <ExamsView isStaff={isStaff} />;
};

export default ExamsPage;
