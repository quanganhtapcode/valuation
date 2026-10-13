import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      // setState inside useEffect is an intentional pattern used throughout the codebase
      // (localStorage init, hydration guards, state resets) — downgrade to warning.
      "react-hooks/set-state-in-effect": "warn",
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/lib/use*", "@/lib/*Context"],
          message: "Import React hooks from @/hooks and context providers from @/contexts.",
        }, {
          group: ["@/app/siteConfig", "@/components/ui/Navbar", "@/components/ui/Footer", "@/components/ui/MainWrapper"],
          message: "Import site configuration from @/config and page layout components from @/components/layout.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
