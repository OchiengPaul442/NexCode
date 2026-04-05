/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./webview/src/**/*.{ts,tsx,js,jsx,html}"],
  theme: {
    extend: {
      colors: {
        slateglass: {
          900: "#0b1220",
          850: "#11192a",
          800: "#141f33",
          700: "#1d2b44",
          600: "#233452",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(148,163,184,0.18), 0 14px 40px rgba(15,23,42,0.5)",
      },
      animation: {
        pulsebar: "pulsebar 1.4s ease-in-out infinite",
        shimmer: "shimmer 1.7s linear infinite",
      },
      keyframes: {
        pulsebar: {
          "0%, 100%": { opacity: "0.45", transform: "scaleY(0.55)" },
          "50%": { opacity: "1", transform: "scaleY(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};
