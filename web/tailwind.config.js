/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0a0a0f",
          1: "#12121a",
          2: "#1a1a26",
          3: "#242435",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#818cf8",
        },
      },
    },
  },
  plugins: [],
};
