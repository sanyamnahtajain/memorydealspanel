import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Vitest 4 removed `environmentMatchGlobs`; projects provide the same split:
// plain .test.ts files run in node, .test.tsx (component) files run in jsdom.
const sharedTest = {
  setupFiles: ["./tests/setup.ts"],
  exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
};

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          ...sharedTest,
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [react(), tsconfigPaths()],
        test: {
          ...sharedTest,
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "tests/unit/**/*.test.tsx"],
        },
      },
    ],
  },
});
