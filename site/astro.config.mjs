// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// External links open in a new tab, as on docs.foxleague.ai (internal links are relative and stay in-page).
function rehypeExternalLinksNewTab() {
	return (/** @type {any} */ tree) => {
		const visit = (/** @type {any} */ node) => {
			if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string' && /^https?:\/\//i.test(node.properties.href)) {
				node.properties.target = '_blank';
				node.properties.rel = ['noopener', 'noreferrer'];
			}
			if (Array.isArray(node.children)) node.children.forEach(visit);
		};
		visit(tree);
	};
}

// Served at https://agent.foxleague.ai, the same stack and look as https://docs.foxleague.ai.
export default defineConfig({
	site: 'https://agent.foxleague.ai',
	trailingSlash: 'always',
	markdown: { rehypePlugins: [rehypeExternalLinksNewTab] },
	integrations: [
		starlight({
			title: 'FoxLeague Agent',
			description: 'Your AI team manager for FoxLeague: an agent that trains, plays and levels up your team on MultiversX Supernova, within the limits you set.',
			// The FoxLeague Agent fox (the fox head with the AI brain): transparent in the dark header and as the tab icon
			// (BRAND-2), the round badge as the home screen icon (BRAND-1).
			logo: { src: './public/brand/logo.png', replacesTitle: false },
			favicon: '/brand/favicon-32.png',
			head: [
				{ tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/brand/favicon-192.png' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/brand/favicon-180.png' } },
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' } },
				{ tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Teko:wght@500;700&display=swap' } },
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://agent.foxleague.ai/og.png?v=2' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://agent.foxleague.ai/og.png' } },
			],
			customCss: ['./src/styles/custom.css'],
			// GitHub: the repository (it opened Foxsy AI's page until the public release).
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/foxsyai/foxleague-agent' },
				{ icon: 'x.com', label: 'X / Twitter', href: 'https://x.com/foxsy_ai' },
				{ icon: 'telegram', label: 'Telegram', href: 'https://t.me/foxsyai' },
				{ icon: 'youtube', label: 'YouTube', href: 'https://youtube.com/@FoxsyAI' },
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Welcome', slug: 'index' },
						{ label: 'Install', slug: 'start/install' },
						{ label: 'Install on Windows', slug: 'start/install-windows' },
						{ label: 'Install on Mac', slug: 'start/install-mac' },
						{ label: 'Install on Linux', slug: 'start/install-linux' },
						{ label: 'Your keys, step by step', slug: 'start/keys' },
						{ label: 'Fund it and go live', slug: 'start/go-live' },
					],
				},
				{
					label: 'Using it',
					items: [
						{ label: 'The dashboard', slug: 'use/dashboard' },
						{ label: 'Import your team', slug: 'use/import-team' },
						{ label: 'Every setting explained', slug: 'use/settings' },
						{ label: 'Talk to your manager', slug: 'use/talk-to-your-manager' },
						{ label: 'Watch your team play', slug: 'use/watch-your-team' },
					],
				},
				{
					label: 'How it plays',
					items: [
						{ label: 'A day in the life', slug: 'play/how-it-plays' },
						{ label: 'Strategy levels', slug: 'play/strategy-levels' },
						{ label: 'Safety and your limits', slug: 'play/safety' },
					],
				},
				{
					label: 'Help',
					items: [
						{ label: 'What it costs', slug: 'help/costs' },
						{ label: 'FAQ', slug: 'help/faq' },
						{ label: 'Troubleshooting', slug: 'help/troubleshooting' },
						{ label: 'Update, uninstall, more agents', slug: 'help/update' },
						{ label: 'Run it on a server', slug: 'help/server' },
					],
				},
			],
		}),
	],
});
