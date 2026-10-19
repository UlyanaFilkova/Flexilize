import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "webextension-polyfill": fileURLToPath(new URL("./tests/mocks/browser.ts", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/vendor.d.ts"],
      thresholds: {
        statements: 65,
        branches: 65,
        functions: 65,
        lines: 65
      }
    }
  }
});
