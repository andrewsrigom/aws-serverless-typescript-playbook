import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scenarios/*/integration/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
