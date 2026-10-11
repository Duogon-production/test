import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import './globals.css';
import type { Metadata } from 'next';
import { Caprasimo, Figtree } from 'next/font/google';
import { ToastProvider } from '@/frontend/components/providers/toast-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import FacebookMessenger from '@/frontend/components/facebook-messenger';
import { isTeacher } from '@/server/services/teacher';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import ScrollToTop from '@/frontend/components/scroll-to-top';
import IntroSplash from '@/frontend/components/intro-splash';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const caprasimo = Caprasimo({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
	title: 'EduLabs | Learning Platform',
	description: 'EduLabs: a modern learning platform template.',
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { userId, sessionClaims } = await auth();
	const isStaff = await isTeacher(userId, sessionClaims);

	return (
		<ClerkProvider afterSignOutUrl="/" appearance={{
				options: { showOptionalFields: true },
				variables: {
					colorPrimary: '#7ed957',
					colorForeground: '#1c2418',
					colorPrimaryForeground: '#000000',
					colorBackground: '#f6f9f2',
					colorInput: '#f6f9f2',
					colorInputForeground: '#1c2418',
					borderRadius: '1rem',
				},
				elements: {
					card: 'border-[2.5px] border-black shadow-hard rounded-[28px]',
					formButtonPrimary:
						'bg-[#7ed957] text-black border-2 border-black rounded-full font-semibold shadow-hard-sm hover:bg-[#7ed957] hover:-translate-y-px hover:shadow-hard transition-all',
					formFieldInput: 'border-2 border-black rounded-xl',
					footerActionLink: 'text-[#2b6416] font-bold',
				},
			}}>
			<html lang="en" suppressHydrationWarning>
				<body className={`${figtree.variable} ${caprasimo.variable} font-sans`}>
					<ThemeProvider
						attribute="class"
						defaultTheme="light"
						forcedTheme="light"
						enableSystem={false}
						disableTransitionOnChange
					>
						<LoadingProvider>
							<IntroSplash />

							<ScrollToTop />

							<ToastProvider />

							{children}

							{!isStaff && <FacebookMessenger />}
						</LoadingProvider>
					</ThemeProvider>
				</body>
			</html>
		</ClerkProvider>
	);
}
