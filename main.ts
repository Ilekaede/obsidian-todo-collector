import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  addIcon,
  TAbstractFile,
} from "obsidian";

interface CompletedTodo {
  text: string;
  completedAt: number;
}

interface TodoCollectorSettings {
  targetDirectories: string[];
  todoTags: string[];
  autoDeleteChecked: boolean;
  autoDeleteHours: number;
  completedTodos: CompletedTodo[];
}

const DEFAULT_SETTINGS: TodoCollectorSettings = {
  targetDirectories: [],
  todoTags: ["#TODO", "#t"],
  autoDeleteChecked: false,
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
  }

  async collectTodos() {
    const { vault } = this.app;
    const settings = this.settings;
    const todoFile = await vault.getAbstractFileByPath("TODO.md");
    let todoContent = "";
    const existingTasks = new Set<string>();
    const now = Date.now();

    // 既存のTODOファイルの内容を読み込む
    if (todoFile) {
      const currentContent = await vault.read(todoFile as TFile);
      const lines = currentContent.split("\n");

      // 完了したタスクの処理
      if (settings.autoDeleteChecked) {
        // 期限切れの完了タスクを削除
        settings.completedTodos = settings.completedTodos.filter(
          (todo) =>
            now - todo.completedAt < settings.autoDeleteHours * 3600 * 1000
        );
        await this.saveSettings();
      }

      // 既存のタスクをSetに追加
      for (const line of lines) {
        if (line.startsWith("- [ ]")) {
          existingTasks.add(line);
        } else if (line.startsWith("- [x]")) {
          // 完了したタスクの時刻を記録
          const taskText = line.substring(6); // "- [x] " を除去
          if (!settings.completedTodos.some((todo) => todo.text === taskText)) {
            settings.completedTodos.push({
              text: taskText,
              completedAt: now,
            });
          }
          existingTasks.add(line);
        }
      }
    }

    // 各ディレクトリからTODOを収集
    for (const dir of settings.targetDirectories) {
      const files = vault
        .getMarkdownFiles()
        .filter((file) => file.path.startsWith(dir));

      for (const file of files) {
        const content = await vault.read(file);
        const lines = content.split("\n");

        for (const line of lines) {
          // 各タグパターンでマッチングを試みる
          for (const tag of settings.todoTags) {
            const regex = new RegExp(`^\\s*${tag}\\s+(.+)$`);
            const match = line.match(regex);
            if (match) {
              const todoText = match[1];
              const newTask = `- [ ] ${todoText} (${file.basename})`;

              // 重複チェック（未完了タスクと完了タスクの両方をチェック）
              const isDuplicate =
                existingTasks.has(newTask) ||
                settings.completedTodos.some(
                  (todo) =>
                    todo.text === `${todoText} (${file.basename})` &&
                    now - todo.completedAt <
                      settings.autoDeleteHours * 3600 * 1000
                );

              if (!isDuplicate) {
                todoContent += newTask + "\n";
                existingTasks.add(newTask);
              }
              break; // マッチしたら次の行へ
            }
          }
        }
      }
    }

    // TODOファイルの内容を更新
    if (todoFile) {
      const currentContent = await vault.read(todoFile as TFile);
      const lines = currentContent.split("\n");

      // 完了したTODOを処理
      if (settings.autoDeleteChecked) {
        // 期限切れの完了タスクを削除
        const newLines = lines.filter((line) => {
          if (!line.startsWith("- [x]")) return true;
          const taskText = line.substring(6); // "- [x] " を除去
          const completedTodo = settings.completedTodos.find(
            (todo) => todo.text === taskText
          );
          return (
            completedTodo &&
            now - completedTodo.completedAt <
              settings.autoDeleteHours * 3600 * 1000
          );
        });
        todoContent = newLines.join("\n") + "\n" + todoContent;
      } else {
        // 完了したTODOを保持
        const completedTodos = lines.filter((line) => line.startsWith("- [x]"));
        todoContent = completedTodos.join("\n") + "\n" + todoContent;
      }

      await vault.modify(todoFile as TFile, todoContent);
    } else {
      await vault.create("TODO.md", todoContent);
    }
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
      .setName("完了したTODOを自動削除")
      .setDesc("完了したTODOを自動的に削除します")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDeleteChecked)
          .onChange(async (value) => {
            this.plugin.settings.autoDeleteChecked = value;
            await this.plugin.saveSettings();
          })
      );

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
