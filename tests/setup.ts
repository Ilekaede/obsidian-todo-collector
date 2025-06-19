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

// テストタイムアウトの設定
// jest.setTimeout(10000);

// テスト後のクリーンアップ
// afterEach(() => {
//   jest.clearAllMocks();
// });
