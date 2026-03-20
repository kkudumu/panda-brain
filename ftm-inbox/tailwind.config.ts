import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				kawaii: {
					mint: {
						50: '#e8f5e9',
						100: '#c8e6c9',
						200: '#a5d6a7',
						300: '#81c784',
						400: '#66bb6a',
						500: '#4caf50',
						600: '#43a047',
						700: '#388e3c',
						800: '#2e7d32',
						900: '#1b5e20',
						950: '#1b2e1b'
					},
					cream: '#fefefe',
					coral: '#ffccbc',
					yellow: '#fff9c4',
					blue: '#bbdefb',
					orange: '#ffe0b2',
					teal: '#b2dfdb',
					red: '#ffcdd2',
					neon: '#69f0ae'
				}
			},
			borderRadius: {
				kawaii: '16px',
				pill: '9999px'
			},
			fontFamily: {
				kawaii: ['Nunito', 'Quicksand', 'sans-serif']
			},
			boxShadow: {
				kawaii: '0 4px 24px 0 rgba(76, 175, 80, 0.10)',
				'kawaii-md': '0 6px 32px 0 rgba(76, 175, 80, 0.15)',
				'kawaii-glow': '0 0 0 2px #69f0ae, 0 4px 24px 0 rgba(105, 240, 174, 0.25)'
			},
			animation: {
				'bounce-in': 'bounceIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55) both',
				'fade-up': 'fadeUp 0.3s ease-out both',
				'spin-once': 'spin 0.4s ease-in-out'
			},
			keyframes: {
				bounceIn: {
					'0%': { opacity: '0', transform: 'scale(0.8)' },
					'100%': { opacity: '1', transform: 'scale(1)' }
				},
				fadeUp: {
					'0%': { opacity: '0', transform: 'translateY(8px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				}
			}
		}
	},
	plugins: []
} satisfies Config;
