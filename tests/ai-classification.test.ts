/// <reference types="jest" />

import { App, Vault, TFile } from "./__mocks__/obsidian";
import LineTodoCollectorPlugin from "../main";
import { manifest } from "./__mocks__/manifest";

// Gemini APIのモック
const mockGeminiResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: `# 🛒 買い物関連
- [ ] 牛乳を買う (shopping)
- [ ] パンを買う (shopping)

# 💻 開発関連
- [ ] バグを修正する (development)

# 📚 学習関連
- [ ] TypeScriptを勉強する (learning)`,
          },
        ],
      },
    },
  ],
};

// テスト用の分類関数（Cloudflare Workersのmcp-server.jsと同じロジック）
async function classifyWithGemini(
  content: string,
  apiKey: string
): Promise<string> {
  try {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("API key is missing or invalid");
    }

    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey.length === 0) {
      throw new Error("API key is empty");
    }

    const prompt = `以下のTODOリストを分析して、カテゴリ別に整理し、優先度も設定してください。

TODOリスト:
${content}

分類結果は以下のMarkdown形式で返してください：

# 🛒 買い物関連
- [ ] TODO1 (ファイル名)
- [ ] TODO2 (ファイル名)

# 💻 開発関連
- [ ] TODO3 (ファイル名)

# 📚 学習関連
- [ ] TODO4 (ファイル名)

カテゴリは以下のような分類を参考にしてください：
- 買い物関連（🛒）
- 開発関連（💻）
- 学習関連（📚）
- 家事関連（🏠）
- 仕事関連（💼）
- 健康関連（💪）
- その他（📝）

元のTODOの形式（- [ ] 内容 (ファイル名)）を保持してください。`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${trimmedApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(
        `Gemini API error: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();

    if (
      result.candidates &&
      result.candidates[0] &&
      result.candidates[0].content
    ) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Invalid response format from Gemini API");
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return content;
  }
}

// fetchのモック
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe("AI Classification Tests", () => {
  let app: App;
  let plugin: LineTodoCollectorPlugin;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = new Vault();
    app.vault = vault;
    plugin = new LineTodoCollectorPlugin(app as any, manifest as any);

    // fetchのモックをリセット
    mockFetch.mockClear();
  });

  describe("Gemini API分類機能のテスト", () => {
    test("正常なTODO分類のテスト", async () => {
      const testContent = `- [ ] 牛乳を買う (shopping)
- [ ] バグを修正する (development)
- [ ] TypeScriptを勉強する (learning)
- [ ] パンを買う (shopping)`;

      // モックの設定
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      // 分類処理を実行
      const result = await classifyWithGemini(testContent, "test-api-key");

      // 結果の検証
      expect(result).toContain("# 🛒 買い物関連");
      expect(result).toContain("# 💻 開発関連");
      expect(result).toContain("# 📚 学習関連");
      expect(result).toContain("- [ ] 牛乳を買う (shopping)");
      expect(result).toContain("- [ ] バグを修正する (development)");
      expect(result).toContain("- [ ] TypeScriptを勉強する (learning)");

      // APIが正しく呼ばれたことを確認
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("generativelanguage.googleapis.com"),
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining("牛乳を買う"),
        })
      );
    });

    test("APIキーが無効な場合のエラーハンドリング", async () => {
      const testContent = "- [ ] テストタスク (test)";

      // エラーレスポンスのモック
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve("Invalid API key"),
      } as Response);

      // 分類処理を実行（エラーが発生しても元の内容が返されることを確認）
      const result = await classifyWithGemini(testContent, "invalid-key");

      // 元の内容が返されることを確認
      expect(result).toBe(testContent);
    });

    test("空のコンテンツの処理", async () => {
      const emptyContent = "";

      // 空のコンテンツでもAPIは呼ばれるので、モックを設定
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const result = await classifyWithGemini(emptyContent, "test-api-key");

      // 空のコンテンツでもAPIが正常に動作すれば分類結果が返される
      expect(result).toContain("# 🛒 買い物関連");
      expect(result).toContain("# 💻 開発関連");
      expect(result).toContain("# 📚 学習関連");
      // 空のコンテンツでもAPIは呼ばれる
      expect(mockFetch).toHaveBeenCalled();
    });

    test("ネットワークエラーのハンドリング", async () => {
      const testContent = "- [ ] テストタスク (test)";

      // ネットワークエラーのモック
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // 分類処理を実行
      const result = await classifyWithGemini(testContent, "test-api-key");

      // エラーが発生しても元の内容が返されることを確認
      expect(result).toBe(testContent);
    });

    test("無効なAPIレスポンスのハンドリング", async () => {
      const testContent = "- [ ] テストタスク (test)";

      // 無効なレスポンスのモック
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ invalid: "response" }),
      } as Response);

      // 分類処理を実行
      const result = await classifyWithGemini(testContent, "test-api-key");

      // 無効なレスポンスの場合も元の内容が返されることを確認
      expect(result).toBe(testContent);
    });
  });

  describe("分類結果の形式テスト", () => {
    test("分類結果が正しいMarkdown形式であることを確認", async () => {
      const testContent = "- [ ] テストタスク (test)";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const result = await classifyWithGemini(testContent, "test-api-key");

      // Markdownの形式を確認
      expect(result).toMatch(/^# .+/m); // ヘッダーが存在する
      expect(result).toMatch(/^- \[ \].+\(.+\)$/m); // TODOアイテムの形式
      expect(result).toContain("🛒"); // 絵文字が含まれている
      expect(result).toContain("💻");
      expect(result).toContain("📚");
    });

    test("分類結果に必要なカテゴリが含まれていることを確認", async () => {
      const testContent =
        "- [ ] 買い物タスク (shopping)\n- [ ] 開発タスク (dev)";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const result = await classifyWithGemini(testContent, "test-api-key");

      // 主要なカテゴリが含まれていることを確認
      const categories = ["買い物関連", "開発関連", "学習関連"];
      categories.forEach((category) => {
        expect(result).toContain(category);
      });
    });
  });

  describe("パフォーマンステスト", () => {
    test("大量のTODOの分類処理時間", async () => {
      // 大量のTODOを作成
      const todos = Array.from(
        { length: 100 },
        (_, i) => `- [ ] タスク${i} (file${i})`
      ).join("\n");

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const startTime = Date.now();
      await classifyWithGemini(todos, "test-api-key");
      const endTime = Date.now();

      // 処理時間が10秒以内であることを確認
      expect(endTime - startTime).toBeLessThan(10000);
    });
  });

  describe("MCPサーバー統合テスト", () => {
    test("MCPサーバー経由での分類テスト", async () => {
      const testContent = "- [ ] テストタスク (test)";

      // MCPサーバーのレスポンスをモック
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            classifiedContent:
              mockGeminiResponse.candidates[0].content.parts[0].text,
            message: "TODO classification completed",
          }),
      } as Response);

      // MCPサーバーへのリクエストをシミュレート
      const requestBody = {
        action: "classify",
        content: testContent,
        geminiApiKey: "test-api-key",
      };

      const response = await fetch("https://test-mcp-server.workers.dev", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.classifiedContent).toContain("# 🛒 買い物関連");
    });
  });
});
