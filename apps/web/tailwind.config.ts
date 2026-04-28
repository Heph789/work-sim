// Tailwind config. Vanilla — no plugins, no custom theme tokens beyond what
// Tailwind ships by default. The small set of `.btn-primary` / `.input` /
// `.label` utilities is defined in app/globals.css via @layer components.

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
