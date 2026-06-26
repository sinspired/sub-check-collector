/**
 * 订阅链接类型
 */
export interface SubscriptionLink {
  url: string;
  type?: string; // V2Ray, Clash 等
  source: string; // 来源仓库
  description?: string; // 链接描述
  foundAt: Date; // 发现时间
}

/**
 * GitHub 仓库信息
 */
export interface Repository {
  fullName: string;
  url: string;
  description?: string;
  stars: number;
  updatedAt: Date;
}

/**
 * 配置接口
 */
export interface Config {
  githubToken?: string;
  searchKeywords: string[];
  keywordGroups?: string[][]; // 多组搜索关键词
  scheduleInterval: string;
  outputFile: string;
  maxRepositories: number;
  configYamlPath?: string;
  minStars?: number;
  maxDaysSinceUpdate?: number;
  validateLinks?: boolean;
  linkValidationTimeout?: number;
  linkValidationConcurrency?: number;
  proxyUrl?: string;
  maxDaysSinceSubUpdate?: number;
  exploreFileTree?: boolean; // 是否遍历仓库根目录查找订阅文件
  logDir?: string;
  enableFileLog?: boolean;
}
