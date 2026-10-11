const buf = require('buffer');
if (!buf.SlowBuffer) {
	buf.SlowBuffer = buf.Buffer;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		domains: ['utfs.io', 'images.unsplash.com', 'img.clerk.com'],
		// Images are referenced by external URL (see shared/image-url.ts)
		remotePatterns: [
			{ protocol: 'https', hostname: '**' },
			{ protocol: 'http', hostname: '**' },
		],
	},
};

module.exports = nextConfig;
