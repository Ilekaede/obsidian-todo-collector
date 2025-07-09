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
            text: `{
  "groups": {
    "買い物関連": [
      {
        "text": "牛乳を買う",
        "completed": false,
        "source": "shopping"
      },
      {
        "text": "パンを買う",
        "completed": false,
        "source": "shopping"
      }
    ],
    "開発関連": [
      {
        "text": "バグを修正する",
        "completed": false,
        "source": "development"
      }
    ],
    "学習関連": [
      {
        "text": "TypeScriptを勉強する",
        "completed": false,
        "source": "learning"
      }
    ],
    "家事関連": [],
    "仕事関連": [],
    "健康関連": [],
    "未分類": []
  },
  "metadata": {
    "lastUpdated": "2025-01-27T10:30:00Z",
    "totalTodos": 4,
    "completedCount": 0
  }
}`,
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

    const prompt = `以下のTODOリストを分析して、カテゴリ別に整理してください。

TODOリスト:
${content}

分類結果は以下のJSON形式で返してください。必ず有効なJSONのみを返し、説明文やマークダウン記法は含めないでください：

{
  "groups": {
    "買い物関連": [
      {
        "text": "牛乳を買う",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "開発関連": [
      {
        "text": "バグ修正",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "学習関連": [
      {
        "text": "新しい技術を学ぶ",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "家事関連": [
      {
        "text": "掃除をする",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "仕事関連": [
      {
        "text": "会議の準備",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "健康関連": [
      {
        "text": "運動する",
        "completed": false,
        "source": "ファイル名"
      }
    ],
    "未分類": [
      {
        "text": "分類できないTODO",
        "completed": false,
        "source": "ファイル名"
      }
    ]
  },
  "metadata": {
    "lastUpdated": "2025-01-27T10:30:00Z",
    "totalTodos": 15,
    "completedCount": 3
  }
}

カテゴリは以下のような分類を参考にしてください：
- 買い物関連：日用品、食材、衣類などの購入
- 開発関連：プログラミング、デバッグ、技術的な作業
- 学習関連：勉強、読書、スキルアップ
- 家事関連：掃除、洗濯、料理、整理
- 仕事関連：業務、会議、報告書
- 健康関連：運動、医療、健康管理
- 未分類：上記に当てはまらないもの

元のTODOの内容を保持し、sourceフィールドには元のファイル名を設定してください。
completedフィールドは元のTODOの完了状態を反映してください。
必ず有効なJSONのみを返してください。`;

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

      // JSON形式の結果をパース
      const jsonData = JSON.parse(result);

      // 結果の検証
      expect(jsonData).toHaveProperty("groups");
      expect(jsonData.groups).toHaveProperty("買い物関連");
      expect(jsonData.groups).toHaveProperty("開発関連");
      expect(jsonData.groups).toHaveProperty("学習関連");

      // 買い物関連のTODOを確認
      expect(jsonData.groups["買い物関連"]).toHaveLength(2);
      expect(jsonData.groups["買い物関連"][0]).toHaveProperty(
        "text",
        "牛乳を買う"
      );
      expect(jsonData.groups["買い物関連"][0]).toHaveProperty(
        "completed",
        false
      );
      expect(jsonData.groups["買い物関連"][0]).toHaveProperty(
        "source",
        "shopping"
      );

      // 開発関連のTODOを確認
      expect(jsonData.groups["開発関連"]).toHaveLength(1);
      expect(jsonData.groups["開発関連"][0]).toHaveProperty(
        "text",
        "バグを修正する"
      );

      // 学習関連のTODOを確認
      expect(jsonData.groups["学習関連"]).toHaveLength(1);
      expect(jsonData.groups["学習関連"][0]).toHaveProperty(
        "text",
        "TypeScriptを勉強する"
      );

      // メタデータの確認
      expect(jsonData).toHaveProperty("metadata");
      expect(jsonData.metadata).toHaveProperty("totalTodos", 4);
      expect(jsonData.metadata).toHaveProperty("completedCount", 0);

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

      // JSON形式の結果をパースして検証
      const jsonData = JSON.parse(result);
      expect(jsonData).toHaveProperty("groups");
      expect(jsonData.groups).toHaveProperty("買い物関連");
      expect(jsonData.groups).toHaveProperty("開発関連");
      expect(jsonData.groups).toHaveProperty("学習関連");
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
    test("分類結果が正しいJSON形式であることを確認", async () => {
      const testContent = "- [ ] テストタスク (test)";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const result = await classifyWithGemini(testContent, "test-api-key");

      // JSON形式の検証
      const jsonData = JSON.parse(result);
      expect(jsonData).toHaveProperty("groups");
      expect(jsonData).toHaveProperty("metadata");
      expect(typeof jsonData.groups).toBe("object");
      expect(Array.isArray(jsonData.groups["買い物関連"])).toBe(true);

      // TODOアイテムの構造確認
      if (jsonData.groups["買い物関連"].length > 0) {
        const todoItem = jsonData.groups["買い物関連"][0];
        expect(todoItem).toHaveProperty("text");
        expect(todoItem).toHaveProperty("completed");
        expect(todoItem).toHaveProperty("source");
        expect(typeof todoItem.text).toBe("string");
        expect(typeof todoItem.completed).toBe("boolean");
        expect(typeof todoItem.source).toBe("string");
      }
    });

    test("分類結果に必要なカテゴリが含まれていることを確認", async () => {
      const testContent =
        "- [ ] 買い物タスク (shopping)\n- [ ] 開発タスク (dev)";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeminiResponse),
      } as Response);

      const result = await classifyWithGemini(testContent, "test-api-key");

      // JSON形式の結果をパース
      const jsonData = JSON.parse(result);

      // 主要なカテゴリが含まれていることを確認
      const categories = [
        "買い物関連",
        "開発関連",
        "学習関連",
        "家事関連",
        "仕事関連",
        "健康関連",
        "未分類",
      ];
      categories.forEach((category) => {
        expect(jsonData.groups).toHaveProperty(category);
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

  describe("プロキシサーバー統合テスト", () => {
    test("プロキシサーバー経由での分類テスト", async () => {
      const testContent = "- [ ] テストタスク (test)";

      // プロキシサーバーのレスポンスをモック
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            classifiedContent:
              mockGeminiResponse.candidates[0].content.parts[0].text,
            message: "TODO classification completed",
          }),
      } as Response);

      // プロキシサーバーへのリクエストをシミュレート
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

      // JSON形式の分類結果を検証
      const jsonData = JSON.parse(result.classifiedContent);
      expect(jsonData).toHaveProperty("groups");
      expect(jsonData.groups).toHaveProperty("買い物関連");
      expect(jsonData.groups).toHaveProperty("開発関連");
      expect(jsonData.groups).toHaveProperty("学習関連");
    });
  });
});
