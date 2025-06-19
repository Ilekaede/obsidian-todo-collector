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
}

const DEFAULT_SETTINGS: TodoCollectorSettings = {
  targetDirectories: [],
  todoTags: ["#TODO", "#t"],
  completedTodoHandling: "immediate", // デフォルトは即時削除
  autoDeleteHours: 24,
  completedTodos: [],
};

const OUTPUT_FILE = "TODO.md";
const RIBBON_ICON = "check-square";

export default class LineTodoCollectorPlugin extends Plugin {
  settings: TodoCollectorSettings;

  async onload() {
    await this.loadSettings();
    addIcon(
      RIBBON_ICON,
      `<svg viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="70" rx="15" fill="none" stroke="currentColor" stroke-width="10"/><polyline points="30,55 45,70 70,40" fill="none" stroke="currentColor" stroke-width="10"/></svg>`
    );
    this.addRibbonIcon(RIBBON_ICON, "TODOを収集", () => {
      this.collectTodos();
    });
    this.addCommand({
      id: "collect-todos",
      name: "TODOを収集",
      callback: () => {
        this.collectTodos();
      },
    });
    this.addSettingTab(new TodoCollectorSettingTab(this.app, this));

    // 定期的にTODOを収集
    this.registerInterval(
      window.setInterval(() => this.collectTodos(), 5 * 60 * 1000)
    );

    // チェックボックスの状態変更を監視
    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;

        const content = await this.app.vault.read(file as TFile);
        const newContent = await this.processCompletedTodos(
          content,
          file as TFile
        );

        if (content !== newContent) {
          await this.app.vault.modify(file as TFile, newContent);
        }
      })
    );
  }

  async collectTodos() {
    const { vault } = this.app;
    const settings = this.settings;
    const todoFile = await vault.getAbstractFileByPath("TODO.md");
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

      // デバッグ用ログ
      console.log(`Searching in directory: ${normalizedDir}`);

      // 該当ディレクトリ配下のファイルをフィルタリング
      const files = allFiles.filter((file) => {
        const filePath = file.path;
        const isMatch = filePath
          .toLowerCase()
          .startsWith(normalizedDir.toLowerCase());
        console.log(
          `Checking file: ${filePath}, matches ${normalizedDir}: ${isMatch}`
        );
        return isMatch;
      });

      console.log(`Found ${files.length} files in ${normalizedDir}`);

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
            // 既存のフロントマターをパースしてadd_todo: trueを追加
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
      await vault.create("TODO.md", finalContent);
    }
  }

  async processCompletedTodos(content: string, file: TFile): Promise<string> {
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
      frontmatter.add_todo = true;
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
        // 既存のフロントマターをパースしてadd_todo: trueを追加
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
      .setDesc(
        "TODOを収集するディレクトリを指定してください（カンマ区切りで複数指定可能）"
      )
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
      .setName("TODOタグ")
      .setDesc(
        "TODOとして認識するタグを指定してください（カンマ区切りで複数指定可能）"
      )
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
      .setDesc("完了済みTODOの処理方法を選択してください")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("immediate", "即時削除")
          .addOption("delayed", "時間を置いて削除")
          .addOption("keep", "保持する")
          .setValue(this.plugin.settings.completedTodoHandling)
          .onChange(async (value) => {
            this.plugin.settings.completedTodoHandling = value as TodoHandling;
            await this.plugin.saveSettings();
            // 設定画面を再描画して関連項目の表示/非表示を更新
            this.display();
          })
      );

    // 時間を置いて削除の場合のみ表示
    if (this.plugin.settings.completedTodoHandling === "delayed") {
      new Setting(containerEl)
        .setName("完了したTODOの削除時間")
        .setDesc("完了したTODOを何時間後に削除するか指定してください")
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
  }
}

function extractFrontmatter(
  fileLines: string[],
  todoLine: string
): string | null {
  const todoLineIndex = fileLines.indexOf(todoLine);
  if (todoLineIndex === -1) return null;

  // TODO行の前のフロントマターを探す
  let start = -1;
  let end = -1;
  for (let i = todoLineIndex - 1; i >= 0; i--) {
    if (fileLines[i].trim() === "---") {
      if (end === -1) {
        end = i;
      } else {
        start = i;
        break;
      }
    }
  }

  if (start !== -1 && end !== -1) {
    return fileLines.slice(start + 1, end).join("\n");
  }
  return null;
}
