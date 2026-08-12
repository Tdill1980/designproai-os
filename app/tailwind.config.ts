import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        poppins: ['Poppins', 'sans-serif'],
        oswald: ['Oswald', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        rajdhani: ['Rajdhani', 'sans-serif'],
        'share-tech-mono': ['Share Tech Mono', 'monospace'],
        'league-spartan': ['League Spartan', 'sans-serif'],
        montserrat: ['Montserrat', 'sans-serif'],
        aileron: ['Aileron', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        'gradient-start': "hsl(var(--gradient-designpro-start))",
        'gradient-end': "hsl(var(--gradient-designpro-end))",
        'gradient-blue-start': "hsl(var(--gradient-blue-start))",
        'gradient-blue-mid': "hsl(var(--gradient-blue-mid))",
        'gradient-blue-end': "hsl(var(--gradient-blue-end))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 20px rgba(96,165,250,0.4), 0 0 40px rgba(217,70,239,0.2)",
          },
          "50%": {
            boxShadow: "0 0 30px rgba(96,165,250,0.6), 0 0 60px rgba(217,70,239,0.3)",
          },
        },
        "gradient-x": {
          "0%, 100%": {
            backgroundPosition: "0% 50%",
          },
          "50%": {
            backgroundPosition: "100% 50%",
          },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "sproket-bob": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "sproket-fade-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "sproket-slide-left": {
          "0%": { transform: "translateX(-30px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "sproket-slide-right": {
          "0%": { transform: "translateX(30px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "sproket-ufo-enter": {
          "0%": { transform: "translateY(-40px) scale(0.8)", opacity: "0" },
          "60%": { transform: "translateY(4px) scale(1.02)", opacity: "1" },
          "100%": { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        "ace-bounce": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        "thumbnail-sparkle": {
          "0%, 100%": {
            boxShadow: "0 0 4px rgba(0,200,255,0.3), 0 0 8px rgba(0,200,255,0.15)",
            borderColor: "rgba(0,200,255,0.5)",
          },
          "50%": {
            boxShadow: "0 0 10px rgba(0,200,255,0.6), 0 0 20px rgba(0,200,255,0.3), 0 0 30px rgba(0,200,255,0.1)",
            borderColor: "rgba(0,200,255,0.8)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "gradient-x": "gradient-x 3s ease infinite",
        shimmer: "shimmer 2s ease-in-out infinite",
        "sproket-bob": "sproket-bob 3s ease-in-out infinite",
        "sproket-fade-up": "sproket-fade-up 0.4s ease-out",
        "sproket-slide-left": "sproket-slide-left 0.5s ease-out",
        "sproket-slide-right": "sproket-slide-right 0.5s ease-out",
        "sproket-ufo-enter": "sproket-ufo-enter 0.5s ease-out",
        "ace-bounce": "ace-bounce 2s ease-in-out infinite",
        "thumbnail-sparkle": "thumbnail-sparkle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
