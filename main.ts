import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  addIcon,
  TAbstractFile,
  parseYaml,
  Vault,
} from "obsidian";

interface CompletedTodo {
  text: string;
  completedAt: number;
}

interface TodoFrontmatter {
  source?: string;
  date?: string;
  messageId?: string;
  userId?: string;
  add_todo?: boolean;
}

type TodoHandling = "immediate" | "delayed" | "keep";

interface TodoCollectorSettings {
  targetDirectories: string[];
  todoTags: string[];
  completedTodoHandling: TodoHandling;
  autoDeleteHours: number;
  completedTodos: CompletedTodo[];
  todoClassificationProxyUrl: string;
  enableAiClassification: boolean;
  geminiApiKey: string;
  outputFilePath: string;
  protectClassifiedFiles: boolean;
  lastClassificationTime: number;
}

const DEFAULT_SETTINGS: TodoCollectorSettings = {
  targetDirectories: [],
  todoTags: ["#TODO", "#t"],
  completedTodoHandling: "immediate",
  autoDeleteHours: 24,
  completedTodos: [],
  todoClassificationProxyUrl: "",
  enableAiClassification: false,
  geminiApiKey: "",
  outputFilePath: "TODO.md",
  protectClassifiedFiles: false,
  lastClassificationTime: 0,
};

const RIBBON_ICON = "brain";

// サーバで使われる既定のグループ名
const DEFAULT_GROUPS = [
  "買い物関連",
  "開発関連",
  "学習関連",
  "家事関連",
  "仕事関連",
  "健康関連",
  "未分類",
];

export default class LineTodoCollectorPlugin extends Plugin {
  settings: TodoCollectorSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    addIcon(
      RIBBON_ICON,
      `<svg viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="70" rx="15" fill="none" stroke="currentColor" stroke-width="10"/><polyline points="30,55 45,70 70,40" fill="none" stroke="currentColor" stroke-width="10"/></svg>`
    );
    this.addRibbonIcon(RIBBON_ICON, "TODOを収集・分類", () => {
      this.collectAndClassifyTodos();
    });

    this.addCommand({
      id: "collect-and-classify-todos",
      name: "TODOを収集・分類",
      callback: () => {
        this.collectAndClassifyTodos();
      },
    });

    this.addSettingTab(new TodoCollectorSettingTab(this.app, this));

    // チェックボックスの状態変更を監視
    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;

        const content = await this.app.vault.read(file as TFile);
        const newContent = await this.processCompletedTodos(content, file.path);

        if (content !== newContent) {
          await this.app.vault.modify(file as TFile, newContent);
        }
      })
    );
  }

  async collectTodos() {
    const { vault } = this.app;
    const settings = this.settings;

    // 設定された出力ファイルパスを使用
    const outputFilePath = settings.outputFilePath || "TODO.md";
    const todoFile = vault.getAbstractFileByPath(outputFilePath);

    // ファイルが存在しない場合のエラーハンドリング
    if (!todoFile) {
      new Notice(`出力ファイルが存在しません: ${outputFilePath}`);
      return;
    }

    // 分類済みファイル保護機能
    if (
      settings.protectClassifiedFiles &&
      settings.lastClassificationTime > 0
    ) {
      const now = Date.now();
      const timeSinceClassification = now - settings.lastClassificationTime;
      const protectionHours = 24; // 24時間保護

      if (timeSinceClassification < protectionHours * 60 * 60 * 1000) {
        new Notice(
          `分類済みファイルは保護されています（${protectionHours}時間以内）`
        );
        return;
      }
    }

    const existingTasks = new Set<string>();
    const newTasks: string[] = [];
    const now = Date.now();

    // 既存のTODOファイルの内容を読み込む
    let existingContent = "";
    if (todoFile) {
      existingContent = await vault.read(todoFile as TFile);
      const lines = existingContent.split("\n");

      // 既存のタスクをSetに追加
      for (const line of lines) {
        if (line.startsWith("- [ ]") || line.startsWith("- [x]")) {
          existingTasks.add(line);
        }
      }
    }

    // 各ディレクトリからTODOを収集
    const allFiles = vault.getMarkdownFiles();
    for (const dir of settings.targetDirectories) {
      // ディレクトリパスの正規化
      const normalizedDir = dir.trim();

      // 該当ディレクトリ配下のファイルをフィルタリング
      const files = allFiles.filter((file) => {
        const filePath = file.path;
        // 出力ファイルは除外
        if (filePath === outputFilePath) {
          return false;
        }
        // ディレクトリパスで始まるファイルのみを対象とする
        // ディレクトリセパレータを考慮して正確に比較
        const normalizedDirWithSlash = normalizedDir.endsWith("/")
          ? normalizedDir
          : normalizedDir + "/";
        return filePath
          .toLowerCase()
          .startsWith(normalizedDirWithSlash.toLowerCase());
      });

      for (const file of files) {
        const content = await vault.read(file);
        const lines = content.split("\n");
        let fileModified = false;
        let newContent = "";

        // フロントマターの解析
        let inFrontmatter = false;
        let frontmatterStart = -1;
        let frontmatterEnd = -1;
        let hasFrontmatter = false;
        let currentFrontmatter: TodoFrontmatter = {};

        // フロントマターの位置を特定
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === "---") {
            if (!inFrontmatter) {
              inFrontmatter = true;
              frontmatterStart = i;
            } else {
              frontmatterEnd = i;
              hasFrontmatter = true;
              break;
            }
          }
        }

        // 既存のフロントマターを解析
        if (hasFrontmatter) {
          const frontmatterContent = lines
            .slice(frontmatterStart + 1, frontmatterEnd)
            .join("\n");
          try {
            currentFrontmatter = parseYaml(
              frontmatterContent
            ) as TodoFrontmatter;
          } catch (e) {
            console.error("Failed to parse frontmatter:", e);
          }
        }

        // add_todoがtrueの場合はスキップ
        if (currentFrontmatter.add_todo) {
          continue;
        }

        let todoFound = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 各タグパターンでマッチングを試みる
          for (const tag of settings.todoTags) {
            const regex = new RegExp(`^\\s*${tag}\\s+(.+)$`);
            const match = line.match(regex);
            if (match) {
              todoFound = true;
              const todoText = match[1];

              const newTask = `- [ ] ${todoText} (${file.basename})`;

              // 重複チェック
              if (!existingTasks.has(newTask)) {
                newTasks.push(newTask);
                existingTasks.add(newTask);
              }
              break;
            }
          }
        }

        // TODOが見つかった場合、フロントマターを更新
        if (todoFound) {
          if (!hasFrontmatter) {
            // フロントマターがない場合は新規作成
            newContent = "---\n";
            newContent += "add_todo: true\n";
            newContent += "---\n";
            newContent += content;
          } else {
            // 既存のフロントマターを更新
            let frontmatterObj: Record<string, any> = {};
            try {
              frontmatterObj =
                parseYaml(
                  lines.slice(frontmatterStart + 1, frontmatterEnd).join("\n")
                ) || {};
            } catch {}
            frontmatterObj.add_todo = true;
            const newFrontmatterLines = Object.entries(frontmatterObj).map(
              ([k, v]) => `${k}: ${v}`
            );
            newContent = lines.slice(0, frontmatterStart + 1).join("\n") + "\n";
            newContent += newFrontmatterLines.join("\n") + "\n";
            newContent += lines.slice(frontmatterEnd).join("\n");
          }
          fileModified = true;
        }

        if (fileModified) {
          await vault.modify(file, newContent);
        }
      }
    }

    // TODOファイルの内容を更新
    let finalContent = "";
    if (todoFile) {
      const lines = existingContent.split("\n");

      switch (settings.completedTodoHandling) {
        case "immediate":
          // 完了済みTODOは即時削除
          const uncompletedTodos = lines.filter((line) =>
            line.startsWith("- [ ]")
          );
          finalContent = [...uncompletedTodos, ...newTasks].join("\n");
          break;

        case "delayed":
          // 期限付きで保持
          const completedTodos = lines.filter((line) => {
            if (!line.startsWith("- [x]")) return false;
            const taskText = line.substring(6);
            const completedTodo = settings.completedTodos.find(
              (todo) => todo.text === taskText
            );
            return (
              completedTodo &&
              now - completedTodo.completedAt <
                settings.autoDeleteHours * 3600 * 1000
            );
          });

          const delayedUncompletedTodos = lines.filter((line) =>
            line.startsWith("- [ ]")
          );
          finalContent = [
            ...completedTodos,
            ...delayedUncompletedTodos,
            ...newTasks,
          ].join("\n");
          break;

        case "keep":
          // すべてのTODOを保持
          const keptCompletedTodos = lines.filter((line) =>
            line.startsWith("- [x]")
          );
          const keptUncompletedTodos = lines.filter((line) =>
            line.startsWith("- [ ]")
          );
          finalContent = [
            ...keptCompletedTodos,
            ...keptUncompletedTodos,
            ...newTasks,
          ].join("\n");
          break;
      }

      await vault.modify(todoFile as TFile, finalContent);
    } else {
      // 新規作成の場合
      finalContent = newTasks.join("\n");
      await vault.create(outputFilePath, finalContent);
    }
  }

  // 完了todoの掃除
  async processCompletedTodos(
    content: string,
    filePath: string
  ): Promise<string> {
    const lines = content.split("\n");
    let modified = false;
    let result: string[] = [];

    // フロントマターの解析
    let inFrontmatter = false;
    let frontmatterStart = -1;
    let frontmatterEnd = -1;
    let frontmatterContent = "";

    // フロントマターの位置を特定
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "---") {
        if (!inFrontmatter) {
          inFrontmatter = true;
          frontmatterStart = i;
        } else {
          frontmatterEnd = i;
          break;
        }
      }
    }

    // 既存のフロントマターを解析
    let frontmatter: TodoFrontmatter = {};
    if (frontmatterStart !== -1 && frontmatterEnd !== -1) {
      frontmatterContent = lines
        .slice(frontmatterStart + 1, frontmatterEnd)
        .join("\n");
      try {
        frontmatter = parseYaml(frontmatterContent) as TodoFrontmatter;
      } catch (e) {
        console.error("Failed to parse frontmatter:", e);
      }
    }

    // チェックボックスの完了状態を確認
    const hasCompletedTodo = lines.some((line) => line.startsWith("- [x]"));
    if (hasCompletedTodo) {
      // 収集元ファイル（出力ファイル以外）の場合のみadd_todoを付与
      const outputFilePath = this.settings.outputFilePath || "TODO.md";
      if (filePath !== outputFilePath) {
        frontmatter.add_todo = true;
      }
      modified = true;

      // 即時削除の場合は、完了したTODOを含む行を削除
      if (this.settings.completedTodoHandling === "immediate") {
        const filteredLines = lines.filter((line) => !line.startsWith("- [x]"));
        return filteredLines.join("\n");
      }
    }

    // フロントマターの更新
    if (modified) {
      if (frontmatterStart === -1) {
        result.push("---");
        result.push(
          Object.entries(frontmatter)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")
        );
        result.push("---");
        result.push(...lines);
      } else {
        // 既存のフロントマターを更新
        let frontmatterObj: Record<string, any> = {};
        try {
          frontmatterObj =
            parseYaml(
              lines.slice(frontmatterStart + 1, frontmatterEnd).join("\n")
            ) || {};
        } catch {}
        const outputFilePath = this.settings.outputFilePath || "TODO.md";
        if (filePath !== outputFilePath) {
          frontmatterObj.add_todo = true;
        }
        const newFrontmatterLines = Object.entries(frontmatterObj).map(
          ([k, v]) => `${k}: ${v}`
        );
        result.push(...lines.slice(0, frontmatterStart + 1));
        result.push(...newFrontmatterLines);
        result.push(...lines.slice(frontmatterEnd));
      }
      return result.join("\n");
    }

    return content;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // プロキシサーバーとの通信機能
  async testProxyConnection(): Promise<void> {
    if (!this.settings.todoClassificationProxyUrl) {
      new Notice("プロキシサーバーURLが設定されていません");
      return;
    }

    try {
      new Notice("プロキシサーバーとの接続をテスト中...");

      const response = await fetch(this.settings.todoClassificationProxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "test",
          content: "テスト用のTODO内容です",
        }),
      });

      if (response.ok) {
        const result = await response.json();
        new Notice(
          `✅ プロキシサーバー接続成功: ${result.message || "接続確認完了"}`
        );
      } else {
        new Notice(
          `❌ プロキシサーバー接続失敗: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.error("プロキシサーバー接続エラー:", error);
      new Notice(
        `❌ プロキシサーバー接続エラー: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // 既存の分類構造と新規TODOを分離するメソッド
  separateExistingAndNewTodos(content: string): {
    existingGroups: Record<string, string[]>;
    newTodos: string[];
  } {
    const lines = content.split("\n");
    const existingGroups: Record<string, string[]> = {};
    const newTodos: string[] = [];
    let currentGroup = "";
    let inGroup = false;

    // 既定グループを初期化
    for (const group of DEFAULT_GROUPS) {
      existingGroups[group] = [];
    }

    for (const line of lines) {
      const trimmedLine = line.trim();

      // グループヘッダー（## で始まる行）を検出
      if (trimmedLine.startsWith("## ")) {
        currentGroup = trimmedLine.substring(3).trim();
        if (!existingGroups[currentGroup]) {
          existingGroups[currentGroup] = [];
        }
        inGroup = true;
        continue;
      }

      // TODOアイテムを検出
      if (trimmedLine.startsWith("- [ ]") || trimmedLine.startsWith("- [x]")) {
        if (inGroup && currentGroup) {
          // 既存のグループに属するTODO
          existingGroups[currentGroup].push(line);
          console.log("追加されました！");
        } else {
          // グループに属していないTODOは未分類グループに追加
          if (!existingGroups["未分類"]) {
            existingGroups["未分類"] = [];
          }
          existingGroups["未分類"].push(line);
          console.log("追加されませんでした");
        }
      } else if (trimmedLine === "" && inGroup) {
        // 空行でグループ終了
        inGroup = false;
        currentGroup = "";
      }
    }

    console.log("存在するグループ:", existingGroups);

    return { existingGroups, newTodos };
  }

  // 既存の分類構造と新しい分類結果を統合するメソッド
  mergeExistingAndNewClassification(
    existingGroups: Record<string, string[]>,
    newClassification: string
  ): string {
    // 新規分類結果をパース
    const newGroups: Record<string, string[]> = {};
    let currentGroup = "";
    let inGroup = false;
    const newLines = newClassification.split("\n");
    for (const line of newLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("# ")) {
        currentGroup = trimmedLine.substring(2).trim();
        if (!newGroups[currentGroup]) {
          newGroups[currentGroup] = [];
        }
        inGroup = true;
        continue;
      } else if (trimmedLine.startsWith("## ")) {
        currentGroup = trimmedLine.substring(3).trim();
        if (!newGroups[currentGroup]) {
          newGroups[currentGroup] = [];
        }
        inGroup = true;
        continue;
      }
      if (
        (trimmedLine.startsWith("- [ ]") || trimmedLine.startsWith("- [x]")) &&
        currentGroup
      ) {
        newGroups[currentGroup].push(line);
      } else if (trimmedLine === "" && inGroup) {
        inGroup = false;
        currentGroup = "";
      }
    }

    // console.log("newGroups", newGroups); OK

    let result: string[] = [];
    for (const groupName of DEFAULT_GROUPS) {
      console.log(
        "check",
        existingGroups[groupName],
        groupName,
        newGroups[groupName],
        groupName
      );
      const mergedTodos = [
        ...(existingGroups[groupName] || []),
        ...(newGroups[groupName] || []),
      ];
      if (mergedTodos.length > 0) {
        result.push(`## ${groupName}`);
        result.push("");
        result.push(...mergedTodos);
        result.push("");
      }
    }
    // console.log("result", result);

    // 既定グループ以外の新規グループも出力
    for (const groupName of Object.keys(newGroups)) {
      if (
        !DEFAULT_GROUPS.includes(groupName) &&
        newGroups[groupName].length > 0
      ) {
        result.push(`## ${groupName}`);
        result.push("");
        result.push(...newGroups[groupName]);
        result.push("");
      }
    }
    console.log("result", result);
    return result.join("\n");
  }

  // グループ構造をコンテンツに変換するメソッド
  convertGroupsToContent(groups: Record<string, string[]>): string {
    const result: string[] = [];
    for (const [groupName, todos] of Object.entries(groups)) {
      if (todos.length > 0) {
        result.push(`## ${groupName}`);
        result.push("");
        result.push(...todos);
        result.push("");
      }
    }
    return result.join("\n");
  }

  // 統合された収集・分類機能
  async collectAndClassifyTodos(): Promise<void> {
    try {
      new Notice("TODOを収集中...");

      // 収集処理を実行（ファイル出力なし）
      const collectedTodos = await this.collectTodosWithoutFileOutput();

      if (collectedTodos.length === 0) {
        new Notice("収集されたTODOがありません");
        return;
      }

      new Notice(`✅ ${collectedTodos.length}個のTODOを収集しました`);

      // AI分類機能が有効な場合は分類を実行
      if (
        this.settings.enableAiClassification &&
        this.settings.todoClassificationProxyUrl
      ) {
        new Notice("AI分類を実行中...");
        await this.classifyNewTodosWithAi(collectedTodos);
      } else {
        // AI分類機能が無効な場合は、収集したTODOをそのままファイルに出力
        const outputFilePath = this.settings.outputFilePath || "TODO.md";
        const todoContent = collectedTodos.join("\n");

        // ファイルを作成または更新
        const todoFile = this.app.vault.getAbstractFileByPath(outputFilePath);
        if (todoFile && todoFile instanceof TFile) {
          await this.app.vault.modify(todoFile, todoContent);
        } else {
          await this.app.vault.create(outputFilePath, todoContent);
        }

        new Notice(
          "AI分類機能が無効です。収集したTODOをファイルに出力しました。"
        );
      }
    } catch (error) {
      console.error("TODO収集・分類エラー:", error);
      new Notice(
        `❌ TODO収集・分類エラー: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // 新規TODOのみを分類するメソッド
  async classifyNewTodosWithAi(newTodos: string[]): Promise<void> {
    if (
      !this.settings.enableAiClassification ||
      !this.settings.todoClassificationProxyUrl
    ) {
      new Notice("AI分類機能が無効か、サーバーURLが設定されていません");
      return;
    }

    try {
      const outputFilePath = this.settings.outputFilePath || "TODO.md";
      const todoFile = this.app.vault.getAbstractFileByPath(outputFilePath);

      // 既存の分類構造を読み込み
      let existingGroups: Record<string, string[]> = {};
      if (todoFile && todoFile instanceof TFile) {
        const existingContent = await this.app.vault.read(todoFile);
        if (existingContent && existingContent.trim() !== "") {
          const parsed = this.separateExistingAndNewTodos(existingContent);
          existingGroups = parsed.existingGroups;
        }
      }

      new Notice(`新規TODO ${newTodos.length}個を分類中...`);

      const requestBody = {
        action: "classify",
        content: newTodos.join("\n"),
        existingGroups: existingGroups,
        geminiApiKey: this.settings.geminiApiKey,
      };

      const response = await fetch(this.settings.todoClassificationProxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      if (response.ok) {
        const result = await response.json();
        console.log("response", result);

        if (result.classifiedContent) {
          // 既存の分類構造と新しい分類結果を統合
          const mergedContent = this.mergeExistingAndNewClassification(
            existingGroups,
            result.classifiedContent
          );

          // 統合結果が空の場合は、既存のTODOを保持しつつ新規TODOを追加
          console.log("trim", mergedContent.trim());
          if (!mergedContent || mergedContent.trim() === "") {
            // 既存のTODOを保持し、新規TODOを「未分類」グループに追加
            if (!existingGroups["未分類"]) {
              existingGroups["未分類"] = [];
            }
            existingGroups["未分類"].push(...newTodos);
            // console.log("eG", existingGroups);

            const fallbackContent = this.convertGroupsToContent(existingGroups);

            // ファイルを作成または更新
            if (todoFile && todoFile instanceof TFile) {
              await this.app.vault.modify(todoFile, fallbackContent);
            } else {
              await this.app.vault.create(outputFilePath, fallbackContent);
            }
            new Notice(
              "⚠️ 統合結果が空でした。既存のTODOを保持し、新規TODOを未分類グループに追加しました。"
            );
          } else {
            // ファイルを作成または更新
            if (todoFile && todoFile instanceof TFile) {
              await this.app.vault.modify(todoFile, mergedContent);
            } else {
              await this.app.vault.create(outputFilePath, mergedContent);
            }

            // 分類完了時刻を記録
            this.settings.lastClassificationTime = Date.now();
            await this.saveSettings();
            new Notice("✅ TODOの分類が完了しました");
          }
        }
      } else {
        // エラーレスポンスの詳細を取得
        let errorDetail = "";
        try {
          const errorResponse = await response.text();
          errorDetail = ` - エラー詳細: ${errorResponse}`;
        } catch (e) {
          errorDetail = " - エラー詳細の取得に失敗";
        }

        new Notice(
          `❌ プロキシ分類失敗: ${response.status} ${response.statusText}${errorDetail}`
        );
      }
    } catch (error) {
      console.error("プロキシ分類エラー:", error);
      new Notice(
        `❌ プロキシ分類エラー: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // ファイル出力なしでTODOを収集するメソッド
  async collectTodosWithoutFileOutput(): Promise<string[]> {
    const { vault } = this.app;
    const settings = this.settings;
    const collectedTodos: string[] = [];
    const existingTasks = new Set<string>();

    // 各ディレクトリからTODOを収集
    const allFiles = vault.getMarkdownFiles();
    for (const dir of settings.targetDirectories) {
      // ディレクトリパスの正規化
      const normalizedDir = dir.trim();

      // 該当ディレクトリ配下のファイルをフィルタリング
      const files = allFiles.filter((file) => {
        const filePath = file.path;
        // 出力ファイルは除外
        const outputFilePath = settings.outputFilePath || "TODO.md";
        if (filePath === outputFilePath) {
          return false;
        }
        // ディレクトリパスで始まるファイルのみを対象とする
        const normalizedDirWithSlash = normalizedDir.endsWith("/")
          ? normalizedDir
          : normalizedDir + "/";
        return filePath
          .toLowerCase()
          .startsWith(normalizedDirWithSlash.toLowerCase());
      });

      for (const file of files) {
        const content = await vault.read(file);
        const lines = content.split("\n");
        let fileModified = false;
        let newContent = "";

        // フロントマターの解析
        let inFrontmatter = false;
        let frontmatterStart = -1;
        let frontmatterEnd = -1;
        let hasFrontmatter = false;
        let currentFrontmatter: TodoFrontmatter = {};

        // フロントマターの位置を特定
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === "---") {
            if (!inFrontmatter) {
              inFrontmatter = true;
              frontmatterStart = i;
            } else {
              frontmatterEnd = i;
              hasFrontmatter = true;
              break;
            }
          }
        }

        // 既存のフロントマターを解析
        if (hasFrontmatter) {
          const frontmatterContent = lines
            .slice(frontmatterStart + 1, frontmatterEnd)
            .join("\n");
          try {
            currentFrontmatter = parseYaml(
              frontmatterContent
            ) as TodoFrontmatter;
          } catch (e) {
            console.error("Failed to parse frontmatter:", e);
          }
        }

        // add_todoがtrueの場合はスキップ
        if (currentFrontmatter.add_todo) {
          continue;
        }

        let todoFound = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 各タグパターンでマッチングを試みる
          for (const tag of settings.todoTags) {
            const regex = new RegExp(`^\\s*${tag}\\s+(.+)$`);
            const match = line.match(regex);
            if (match) {
              todoFound = true;
              const todoText = match[1];

              const newTask = `- [ ] ${todoText} (${file.basename})`;

              // 重複チェック
              if (!existingTasks.has(newTask)) {
                collectedTodos.push(newTask);
                existingTasks.add(newTask);
              }
              break;
            }
          }
        }

        // TODOが見つかった場合、フロントマターを更新
        if (todoFound) {
          if (!hasFrontmatter) {
            // フロントマターがない場合は新規作成
            newContent = "---\n";
            newContent += "add_todo: true\n";
            newContent += "---\n";
            newContent += content;
          } else {
            // 既存のフロントマターを更新
            let frontmatterObj: Record<string, any> = {};
            try {
              frontmatterObj =
                parseYaml(
                  lines.slice(frontmatterStart + 1, frontmatterEnd).join("\n")
                ) || {};
            } catch {}
            frontmatterObj.add_todo = true;
            const newFrontmatterLines = Object.entries(frontmatterObj).map(
              ([k, v]) => `${k}: ${v}`
            );
            newContent = lines.slice(0, frontmatterStart + 1).join("\n") + "\n";
            newContent += newFrontmatterLines.join("\n") + "\n";
            newContent += lines.slice(frontmatterEnd).join("\n");
          }
          fileModified = true;
        }

        if (fileModified) {
          await vault.modify(file, newContent);
        }
      }
    }

    return collectedTodos;
  }
}

class TodoCollectorSettingTab extends PluginSettingTab {
  plugin: LineTodoCollectorPlugin;
  constructor(app: App, plugin: LineTodoCollectorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TODO Collector 設定" });

    new Setting(containerEl)
      .setName("収集対象ディレクトリ")
      .setDesc("TODOを収集するディレクトリを指定（カンマ区切りで複数可）")
      .addText((text) =>
        text
          .setPlaceholder("例: LINE, プロジェクト")
          .setValue(this.plugin.settings.targetDirectories.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.targetDirectories = value
              .split(",")
              .map((dir) => dir.trim());
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("出力ファイルパス")
      .setDesc("TODOを出力するVault配下のファイルパスを指定")
      .addText((text) =>
        text
          .setPlaceholder(".md, path/todo.md")
          .setValue(this.plugin.settings.outputFilePath)
          .onChange(async (value) => {
            this.plugin.settings.outputFilePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("TODOタグ")
      .setDesc("TODOとして認識するタグを指定（カンマ区切りで複数可）")
      .addText((text) =>
        text
          .setPlaceholder("例: #TODO, #t")
          .setValue(this.plugin.settings.todoTags.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.todoTags = value
              .split(",")
              .map((tag) => tag.trim());
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("完了済みTODOの処理")
      .setDesc("完了済みTODOの処理方法を選択")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("immediate", "即時削除")
          .addOption("delayed", "時間を置いて削除")
          .addOption("keep", "保持する")
          .setValue(this.plugin.settings.completedTodoHandling)
          .onChange(async (value) => {
            this.plugin.settings.completedTodoHandling = value as TodoHandling;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // 時間を置いて削除の場合のみ表示
    if (this.plugin.settings.completedTodoHandling === "delayed") {
      new Setting(containerEl)
        .setName("完了したTODOの削除時間")
        .setDesc("完了TODOを何時間後に削除するか指定")
        .addText((text) =>
          text
            .setPlaceholder("24")
            .setValue(String(this.plugin.settings.autoDeleteHours))
            .onChange(async (value) => {
              const hours = parseInt(value);
              if (!isNaN(hours) && hours > 0) {
                this.plugin.settings.autoDeleteHours = hours;
                await this.plugin.saveSettings();
              }
            })
        );
    }

    // AI分類機能
    containerEl.createEl("h3", { text: "AI分類機能" });

    new Setting(containerEl)
      .setName("AI分類機能を有効にする")
      .setDesc("TODOの自動分類・グループ化機能を有効にします")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAiClassification)
          .onChange(async (value) => {
            this.plugin.settings.enableAiClassification = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // AI分類機能が有効な場合のみ表示
    if (this.plugin.settings.enableAiClassification) {
      new Setting(containerEl)
        .setName("プロキシサーバーURL")
        .setDesc("分類サーバーのURLを指定")
        .addText((text) =>
          text
            .setPlaceholder(
              "https://your-mcp-server.your-subdomain.workers.dev"
            )
            .setValue(this.plugin.settings.todoClassificationProxyUrl)
            .onChange(async (value) => {
              this.plugin.settings.todoClassificationProxyUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );

      // テストボタン
      new Setting(containerEl)
        .setName("プロキシサーバー接続テスト")
        .setDesc("プロキシサーバーとの接続をテストします")
        .addButton((button) =>
          button.setButtonText("テスト実行").onClick(async () => {
            await this.plugin.testProxyConnection();
          })
        );

      // Gemini APIキー設定
      new Setting(containerEl)
        .setName("Gemini APIキー")
        .setDesc("Google Gemini APIキーを設定")
        .addText((text) =>
          text
            .setPlaceholder("AIzaSy...")
            .setValue(this.plugin.settings.geminiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.geminiApiKey = value.trim();
              await this.plugin.saveSettings();
            })
        );

      // 分類済みファイル保護機能
      new Setting(containerEl)
        .setName("分類済みファイルを保護する")
        .setDesc("分類済みファイルを一定時間保護し、上書きを防ぎます")
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.protectClassifiedFiles)
            .onChange(async (value) => {
              this.plugin.settings.protectClassifiedFiles = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
