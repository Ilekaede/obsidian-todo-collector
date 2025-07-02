// テストのセットアップファイル
// 必要に応じてテストの前処理や後処理を追加できます

// Jestの型定義をインポート
import "@jest/globals";

// グローバルなモック設定
(global as any).console = {
  ...console,
  // テスト中のコンソールログを抑制（必要に応じて）
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// AI分類テストのためのグローバル設定
beforeAll(() => {
  // テスト環境の設定
  process.env.NODE_ENV = "test";
  process.env.CI = "true";

  // テスト用のAPIキーを設定（実際のAPIは呼ばれない）
  process.env.GEMINI_API_KEY = "test-api-key-for-ci";
  process.env.MCP_SERVER_URL = "https://test-mcp-server.workers.dev";
});

// テスト後のクリーンアップ
afterEach(() => {
  jest.clearAllMocks();
});

// テストタイムアウトの設定（AI分類テスト用）
jest.setTimeout(30000);
