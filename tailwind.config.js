/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0d0a0e',
          800: '#171319',
          700: '#211a23',
          600: '#2e2431',
          500: '#453648',
        },
        brand: {
          DEFAULT: '#FF4E8B',
          soft: '#FFA3C4',
          dim: '#7d2444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
