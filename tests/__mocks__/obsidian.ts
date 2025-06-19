// Obsidian API のモック
export class App {
  vault: Vault;

  constructor() {
    this.vault = new Vault();
  }
}

export class Vault {
  private files: Map<string, TFile> = new Map();

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path)?.content || "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    const existingFile = this.files.get(file.path);
    if (existingFile) {
      existingFile.content = content;
    }
  }

  async create(path: string, content: string): Promise<TFile> {
    const file = new TFile(path, content);
    this.files.set(path, file);
    return file;
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values()).filter((file) =>
      file.path.endsWith(".md")
    );
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) || null;
  }

  on(event: string, callback: (file: TAbstractFile) => void): void {
    // イベントリスナーのモック
  }
}

export class TFile {
  path: string;
  basename: string;
  content: string;

  constructor(path: string, content: string = "") {
    this.path = path;
    this.basename = path.split("/").pop()?.replace(".md", "") || "";
    this.content = content;
  }
}

export class TAbstractFile {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
}

export class Plugin {
  app: App;
  settings: any;

  constructor(app: App) {
    this.app = app;
  }

  async loadData(): Promise<any> {
    return {};
  }

  async saveData(data: any): Promise<void> {
    // データ保存のモック
  }

  addRibbonIcon(icon: string, title: string, callback: () => void): void {
    // リボンアイコンのモック
  }

  addCommand(command: any): void {
    // コマンドのモック
  }

  addSettingTab(tab: any): void {
    // 設定タブのモック
  }

  registerInterval(interval: number): void {
    // インターバルのモック
  }

  registerEvent(event: any): void {
    // イベントのモック
  }
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {
    // 表示のモック
  }
}

export class Setting {
  constructor(containerEl: any) {
    // 設定のモック
  }

  setName(name: string): Setting {
    return this;
  }

  setDesc(desc: string): Setting {
    return this;
  }

  addText(callback: (text: any) => void): Setting {
    return this;
  }

  addDropdown(callback: (dropdown: any) => void): Setting {
    return this;
  }
}

export function addIcon(name: string, svg: string): void {
  // アイコンのモック
}

export function parseYaml(content: string): any {
  // 1行ごとにkey: valueをパース
  const obj: Record<string, any> = {};
  content.split("\n").forEach((line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      obj[key.trim()] = rest.join(":").trim();
    }
  });
  return obj;
}

export class Notice {
  constructor(message: string) {
    // 通知のモック
  }
}
