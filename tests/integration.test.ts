/// <reference types="jest" />

import { App, Vault, TFile } from "../tests/__mocks__/obsidian";
import LineTodoCollectorPlugin from "../main";
import { manifest } from "./__mocks__/manifest";

describe("LineTodoCollectorPlugin Integration Tests", () => {
  let app: App;
  let plugin: LineTodoCollectorPlugin;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = new Vault();
    app.vault = vault;
    plugin = new LineTodoCollectorPlugin(app as any, manifest as any);
  });

  describe("エンドツーエンドテスト", () => {
    test("TODO収集から完了処理までの一連の流れ", async () => {
      // 1. 設定を読み込み
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["project"];
      plugin.settings.completedTodoHandling = "immediate";

      // 2. テストファイルを作成
      const testFile = new TFile(
        "project/task.md",
        "# プロジェクトタスク\n#TODO 重要なタスク\n#TODO 緊急タスク"
      );
      (vault as any).files.set("project/task.md", testFile);

      // 3. TODOを収集
      await plugin.collectTodos();

      // 4. TODO.mdファイルが作成されていることを確認
      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      expect(todoFile).toBeDefined();
      expect(todoFile.content).toContain("- [ ] 重要なタスク (task)");
      expect(todoFile.content).toContain("- [ ] 緊急タスク (task)");

      // 5. 完了済みTODOの処理をテスト
      const completedContent = todoFile.content.replace(
        "- [ ] 重要なタスク (task)",
        "- [x] 重要なタスク (task)"
      );

      // 6. 完了済みTODOを処理
      const processedContent = await plugin.processCompletedTodos(
        completedContent
      );

      // 7. 完了済みTODOが削除されていることを確認
      expect(processedContent).not.toContain("- [x] 重要なタスク (task)");
      expect(processedContent).toContain("- [ ] 緊急タスク (task)");
    });

    test("複数ディレクトリからのTODO収集", async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["project1", "project2"];

      // 複数のディレクトリにファイルを作成
      const file1 = new TFile(
        "project1/task1.md",
        "#TODO プロジェクト1のタスク"
      );
      const file2 = new TFile(
        "project2/task2.md",
        "#TODO プロジェクト2のタスク"
      );
      (vault as any).files.set("project1/task1.md", file1);
      (vault as any).files.set("project2/task2.md", file2);

      await plugin.collectTodos();

      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      expect(todoFile.content).toContain("- [ ] プロジェクト1のタスク (task1)");
      expect(todoFile.content).toContain("- [ ] プロジェクト2のタスク (task2)");
    });

    test("フロントマター付きファイルの処理", async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["project"];

      const fileWithFrontmatter = new TFile(
        "project/with-frontmatter.md",
        "---\ntitle: テストファイル\ndate: 2024-01-01\n---\n#TODO フロントマター付きタスク"
      );
      (vault as any).files.set(
        "project/with-frontmatter.md",
        fileWithFrontmatter
      );

      await plugin.collectTodos();

      // ファイルにadd_todoフロントマターが追加されていることを確認
      const updatedFile = (vault as any).files.get(
        "project/with-frontmatter.md"
      );
      expect(updatedFile.content).toContain("add_todo: true");
      expect(updatedFile.content).toContain("title: テストファイル");
    });
  });

  describe("エラーハンドリング", () => {
    test("存在しないディレクトリの処理", async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["nonexistent"];

      // エラーが発生しないことを確認
      await expect(plugin.collectTodos()).resolves.not.toThrow();
    });

    test("空のファイルの処理", async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["project"];

      const emptyFile = new TFile("project/empty.md", "");
      (vault as any).files.set("project/empty.md", emptyFile);

      await expect(plugin.collectTodos()).resolves.not.toThrow();
    });
  });

  describe("パフォーマンステスト", () => {
    test("大量のファイルの処理", async () => {
      await plugin.loadSettings();
      plugin.settings.targetDirectories = ["large-project"];

      // 100個のファイルを作成
      for (let i = 0; i < 100; i++) {
        const file = new TFile(`large-project/file${i}.md`, `#TODO タスク${i}`);
        (vault as any).files.set(`large-project/file${i}.md`, file);
      }

      const startTime = Date.now();
      await plugin.collectTodos();
      const endTime = Date.now();

      // 処理時間が5秒以内であることを確認
      expect(endTime - startTime).toBeLessThan(5000);

      const todoFile = vault.getAbstractFileByPath("TODO.md") as TFile;
      const lines = todoFile.content
        .split("\n")
        .filter((line) => line.startsWith("- [ ]"));
      expect(lines).toHaveLength(100);
    });
  });
});
