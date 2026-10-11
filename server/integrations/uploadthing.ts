import 'server-only';

import { isTeacher } from '@/server/services/teacher';
import { auth } from '@clerk/nextjs/server';
import { createUploadthing, type FileRouter } from 'uploadthing/next';

const f = createUploadthing({
	errorFormatter: (error) => {
		const message =
			error instanceof Error
				? error.message
				: 'File upload failed. Please try again.';

		console.error('[UPLOADTHING_ERROR]', error);

		return {
			message,
		};
	},
});

const ensureUploadThingIsConfigured = () => {
	const token = process.env.UPLOADTHING_TOKEN ?? '';

	if (!token) {
		throw new Error(
			'File uploads are not configured. Add a valid UPLOADTHING_TOKEN to .env, then restart the development server.'
		);
	}
};

const handleAuth = async () => {
	ensureUploadThingIsConfigured();

	const { userId } = await auth();

	if (!userId) {
		throw new Error('You must sign in before uploading course files.');
	}

	const isAuthorized = await isTeacher(userId);

	if (!isAuthorized) {
		throw new Error('Only teacher or admin accounts can upload course files.');
	}

	return { userId };
};

const handleStudentAuth = async () => {
	ensureUploadThingIsConfigured();

	const { userId } = await auth();

	if (!userId) throw new Error('You must sign in before submitting homework.');
	return { userId };
};

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
	courseAttachment: f({
		pdf: { maxFileSize: '64MB', maxFileCount: 1 },
		text: { maxFileSize: '64MB', maxFileCount: 1 },
	})
		.middleware(() => handleAuth())
		.onUploadComplete(() => {}),
	chapterVideo: f({
		video: { maxFileSize: '512MB', maxFileCount: 1 },
		audio: { maxFileSize: '512MB', maxFileCount: 1 },
	})
		.middleware(() => handleAuth())
		.onUploadComplete(() => {}),
	homeworkSolutionVideo: f({
		video: { maxFileSize: '512MB', maxFileCount: 1 },
		audio: { maxFileSize: '512MB', maxFileCount: 1 },
	})
		.middleware(() => handleAuth())
		.onUploadComplete(() => {}),
	homeworkSubmission: f({
		image: { maxFileSize: '16MB', maxFileCount: 1 },
		pdf: { maxFileSize: '32MB', maxFileCount: 1 },
	})
		.middleware(() => handleStudentAuth())
		.onUploadComplete(() => {}),
	// Handwritten photo answers for written exam questions.
	examAnswerImage: f({
		image: { maxFileSize: '16MB', maxFileCount: 1 },
	})
		.middleware(() => handleStudentAuth())
		.onUploadComplete(() => {}),
	// Screenshots and PDFs attached to support chat messages.
	supportAttachment: f({
		image: { maxFileSize: '16MB', maxFileCount: 3 },
		pdf: { maxFileSize: '16MB', maxFileCount: 3 },
	})
		.middleware(async () => {
			ensureUploadThingIsConfigured();
			const { userId } = await auth();
			if (!userId) throw new Error('You must sign in before attaching files.');
			return { userId };
		})
		.onUploadComplete(() => {}),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
