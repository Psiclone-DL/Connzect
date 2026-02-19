import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        mintBlack: '#0f1716',
        mintBlackSoft: '#14211f',
        burgundy: '#5d1428',
        burgundySoft: '#77213a',
        card: '#162524cc',
        frosted: '#ffffff0f'
      },
      boxShadow: {
        soft: '0 16px 40px rgba(0, 0, 0, 0.25)',
        glow: '0 0 0 1px rgba(255, 255, 255, 0.08), 0 10px 30px rgba(119, 33, 58, 0.25)'
      },
      animation: {
        rise: 'rise 0.4s ease-out',
        shimmer: 'shimmer 3.4s linear infinite'
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      }
    }
  },
  plugins: []
};

export default config;
