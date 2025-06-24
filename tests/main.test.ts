/// <reference types="jest" />

import { App, Vault, TFile } from "../tests/__mocks__/obsidian";
import LineTodoCollectorPlugin from "../main";
import { manifest } from "./__mocks__/manifest";

describe("LineTodoCollectorPlugin", () => {
  let app: App;
  let plugin: LineTodoCollectorPlugin;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = new Vault();
    app.vault = vault;
    plugin = new LineTodoCollectorPlugin(app as any, manifest as any);
  });

  describe("初期化", () => {
    test("プラグインが正しく初期化される", () => {
      expect(plugin).toBeDefined();
      expect(plugin.app).toBe(app);
    });

    test("デフォルト設定が正しく設定される", async () => {
      await plugin.loadSettings();
      expect(plugin.settings.targetDirectories).toEqual([]);
      expect(plugin.settings.todoTags).toEqual(["#TODO", "#t"]);
      expect(plugin.settings.completedTodoHandling).toBe("immediate");
      expect(plugin.settings.autoDeleteHours).toBe(24);
    });
  });

  describe("TODO収集機能", () => {
    beforeEach(async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["test"];
    });

    test("TODOタグを含むファイルからTODOを収集できる", async () => {
      // テスト用のファイルを作成
      const testFile = new TFile(
        "test/sample.md",
        "# Sample\n#TODO テストタスク\n# その他の内容"
      );
      (vault as any).files.set("test/sample.md", testFile);

      await plugin.collectTodos();

      // TODO.mdファイルが作成されることを確認
      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      expect(todoFile).toBeDefined();
      expect(todoFile.content).toContain("- [ ] テストタスク (sample)");
    });

    test("複数のTODOタグを認識できる", async () => {
      plugin.settings.todoTags = ["#TODO", "#t", "#task"];

      const testFile = new TFile(
        "test/multi.md",
        "# Sample\n#TODO タスク1\n#t タスク2\n#task タスク3"
      );
      (vault as any).files.set("test/multi.md", testFile);

      await plugin.collectTodos();

      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      expect(todoFile.content).toContain("- [ ] タスク1 (multi)");
      expect(todoFile.content).toContain("- [ ] タスク2 (multi)");
      expect(todoFile.content).toContain("- [ ] タスク3 (multi)");
    });

    test("重複するTODOは追加されない", async () => {
      const testFile = new TFile(
        "test/duplicate.md",
        "# Sample\n#TODO 同じタスク\n#TODO 同じタスク"
      );
      (vault as any).files.set("test/duplicate.md", testFile);

      await plugin.collectTodos();

      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      const lines = todoFile.content.split("\n");
      const taskLines = lines.filter((line) => line.includes("同じタスク"));
      expect(taskLines).toHaveLength(1);
    });
  });

  describe("完了済みTODOの処理", () => {
    beforeEach(async () => {
      await plugin.loadSettings();
    });

    test("即時削除モードで完了済みTODOを削除できる", async () => {
      plugin.settings.completedTodoHandling = "immediate";

      const content = "# Sample\n- [x] 完了したタスク\n- [ ] 未完了タスク";
      const result = await plugin.processCompletedTodos(content, "TODO.md");

      expect(result).not.toContain("- [x] 完了したタスク");
      expect(result).toContain("- [ ] 未完了タスク");
    });

    test("保持モードで完了済みTODOを保持する", async () => {
      plugin.settings.completedTodoHandling = "keep";

      const content = "# Sample\n- [x] 完了したタスク\n- [ ] 未完了タスク";
      const result = await plugin.processCompletedTodos(content, "TODO.md");

      expect(result).toContain("- [x] 完了したタスク");
      expect(result).toContain("- [ ] 未完了タスク");
    });
  });

  describe("フロントマター処理", () => {
    beforeEach(async () => {
      await plugin.loadSettings();
    });

    test("フロントマターなしのファイルにフロントマターを追加できる", async () => {
      plugin.settings.completedTodoHandling = "keep";
      const content = "# Sample\n- [x] テストタスク";
      const result = await plugin.processCompletedTodos(content, "test.md");

      expect(result).toContain("---");
      expect(result).toContain("add_todo: true");
    });

    test("既存のフロントマターにadd_todoを追加できる", async () => {
      plugin.settings.completedTodoHandling = "keep";
      const content = "---\ntitle: Test\n---\n# Sample\n- [x] テストタスク";

      console.log("=== INPUT CONTENT ===");
      console.log(content);
      console.log("=== END INPUT CONTENT ===");

      const result = await plugin.processCompletedTodos(content, "test.md");

      console.log("=== TEST RESULT ===");
      console.log(result);
      console.log("=== END TEST RESULT ===");

      expect(result).toContain("title: Test");
      expect(result).toContain("add_todo: true");
    });
  });

  describe("設定の保存と読み込み", () => {
    test("設定を保存できる", async () => {
      const mockSaveData = jest.spyOn(plugin, "saveData").mockResolvedValue();

      await plugin.saveSettings();

      expect(mockSaveData).toHaveBeenCalled();
    });

    test("設定を読み込める", async () => {
      const mockLoadData = jest.spyOn(plugin, "loadData").mockResolvedValue({
        targetDirectories: ["custom"],
        todoTags: ["#CUSTOM"],
      });

      await plugin.loadSettings();

      expect(plugin.settings.targetDirectories).toEqual(["custom"]);
      expect(plugin.settings.todoTags).toEqual(["#CUSTOM"]);
    });
  });
});
