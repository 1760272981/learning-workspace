/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#123524',
        cream: '#fdfcf6',
        leaf: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        honey: {
          100: '#fef3c7',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      fontFamily: {
        display: ['Fredoka', 'Baloo 2', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        body: ['Nunito', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 8px rgba(18,53,36,0.08), 0 8px 24px rgba(18,53,36,0.06)',
        pop: '0 4px 12px rgba(18,53,36,0.12), 0 16px 40px rgba(18,53,36,0.14)',
        fruit: '0 3px 6px rgba(18,53,36,0.25)',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        drift: {
          '0%': { transform: 'translateX(-4%)' },
          '100%': { transform: 'translateX(4%)' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        floaty: 'floaty 4s ease-in-out infinite',
        drift: 'drift 12s ease-in-out infinite alternate',
        riseIn: 'riseIn .45s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
}
