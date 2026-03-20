import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ftm-inbox-theme';

function getInitialTheme(): Theme {
	if (!browser) return 'light';
	const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
	if (stored === 'light' || stored === 'dark') return stored;
	// Respect system preference on first visit
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createThemeStore() {
	const { subscribe, set, update } = writable<Theme>(getInitialTheme());

	function applyTheme(theme: Theme) {
		if (!browser) return;
		document.body.classList.remove('theme-light', 'theme-dark');
		document.body.classList.add(`theme-${theme}`);
		localStorage.setItem(STORAGE_KEY, theme);
	}

	return {
		subscribe,
		set(theme: Theme) {
			applyTheme(theme);
			set(theme);
		},
		toggle() {
			update((current) => {
				const next: Theme = current === 'light' ? 'dark' : 'light';
				applyTheme(next);
				return next;
			});
		},
		init() {
			const theme = getInitialTheme();
			applyTheme(theme);
			set(theme);
		}
	};
}

export const theme = createThemeStore();
