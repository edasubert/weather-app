import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {},
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('hc', ':is(.hc) &');
      addVariant('dark-hc', ':is(.dark.hc) &');
    }),
  ],
};
