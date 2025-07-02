module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["main.ts", "!**/*.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts",
  },
  // AI分類テストのための設定
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 30000, // AI分類テストのためのタイムアウト延長
  verbose: true,
  // CI環境での設定
  ci: process.env.CI === "true",
  // テストの並列実行を制限（API呼び出しのため）
  maxWorkers: process.env.CI === "true" ? 1 : "50%",
};
