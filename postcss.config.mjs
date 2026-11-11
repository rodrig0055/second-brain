const config = {
  plugins: {
    // Replaces the `@stylex;` directive in src/app/stylex.css with the CSS of every stylex.create
    // call in app source. Runs before Tailwind so the generated rules sit in that file's layer.
    "@stylexswc/postcss-plugin": {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts", "src/app/api/**"],
      rsOptions: { dev: process.env.NODE_ENV === "development" },
    },
    "@tailwindcss/postcss": {},
  },
};

export default config;
