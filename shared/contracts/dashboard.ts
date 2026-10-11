export interface StudentLesson {
	id: string;
	title: string;
	description: string | null;
	imageUrl: string | null;
	chapterType: string;
	chapterNumber: number | null;
	chapters: {
		id: string;
		title: string;
		isCompleted: boolean;
	}[];
}

export interface SelfLearningLesson {
	id: string;
	title: string;
	description: string | null;
	imageUrl: string | null;
	chapterType: string;
	chapterNumber: number | null;
	chapters: {
		id: string;
		title: string;
		isCompleted: boolean;
	}[];
}

export interface SelfLearningChapter {
	/** Prefix such as "Chapter" or "Month". */
	type: string;
	number: number;
	/** The chapter's own name, e.g. "Ohm's Law". */
	title: string;
	/** Quick short summary. */
	subtitle: string;
	/** Optional full description. */
	description: string;
	lessonCount: number;
	lessons: SelfLearningLesson[];
}

export interface PeerMember {
	id: string;
	name: string;
	email: string;
	role: string;
	isCurrentUser: boolean;
	latestSubmission: {
		id: string;
		status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
		createdAt: string;
		chapterTitle: string;
		courseTitle?: string;
		timeAgo: string;
	} | null;
}

export interface GroupRosterViewProps {
	groupName: string;
	nextSession: {
		date: string;
		dayLabel: string;
		timeLabel: string;
		fullFormatted: string;
	} | null;
	peers: PeerMember[];
}
