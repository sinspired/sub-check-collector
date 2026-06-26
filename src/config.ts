import * as dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

const DEFAULT_KEYWORD_GROUPS = [
  ['free', 'v2ray', 'subscription'],
  ['vmess', 'free', 'nodes'],
  ['clash', 'proxy', 'subscription'],
  ['v2ray', 'config', 'daily'],
  ['free', 'vpn', 'proxy', 'list'],
  ['vless', 'free', 'nodes'],
  ['trojan', 'free', 'proxy'],
];

export const DEFAULT_CONFIG: Config = {
  githubToken: process.env.GITHUB_TOKEN,
  searchKeywords: ['free', 'v2ray'],
  keywordGroups: DEFAULT_KEYWORD_GROUPS,
  scheduleInterval: '0 2 * * *',
  outputFile: './output/subscriptions.md',
  maxRepositories: 30,
  configYamlPath: './config.yaml',
  minStars: 0,
  maxDaysSinceUpdate: 90,
  validateLinks: false,
  linkValidationTimeout: 10000,
  linkValidationConcurrency: 10,
  proxyUrl: undefined,
  maxDaysSinceSubUpdate: 3,
  exploreFileTree: false,
  logDir: './logs',
  enableFileLog: true,
};

function safeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function parseKeywordGroups(envValue?: string): string[][] {
  if (!envValue) return DEFAULT_KEYWORD_GROUPS;
  // 格式: "free,v2ray,subscription|vmess,free,nodes|clash,proxy,subscription"
  return envValue.split('|').map(group => group.split(',').filter(Boolean)).filter(g => g.length > 0);
}

export function loadConfig(): Config {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    githubToken: token || undefined,
    searchKeywords: process.env.SEARCH_KEYWORDS?.split(',').filter(Boolean) || DEFAULT_CONFIG.searchKeywords,
    keywordGroups: parseKeywordGroups(process.env.KEYWORD_GROUPS),
    scheduleInterval: process.env.SCHEDULE_INTERVAL || DEFAULT_CONFIG.scheduleInterval,
    outputFile: process.env.OUTPUT_FILE || DEFAULT_CONFIG.outputFile,
    maxRepositories: safeInt(process.env.MAX_REPOSITORIES, DEFAULT_CONFIG.maxRepositories ?? 30),
    configYamlPath: process.env.CONFIG_YAML_PATH || DEFAULT_CONFIG.configYamlPath,
    minStars: safeInt(process.env.MIN_STARS, DEFAULT_CONFIG.minStars ?? 0),
    maxDaysSinceUpdate: safeInt(process.env.MAX_DAYS_SINCE_UPDATE, DEFAULT_CONFIG.maxDaysSinceUpdate ?? 90),
    validateLinks: process.env.VALIDATE_LINKS === 'true' || DEFAULT_CONFIG.validateLinks,
    linkValidationTimeout: safeInt(process.env.LINK_VALIDATION_TIMEOUT, DEFAULT_CONFIG.linkValidationTimeout ?? 10000),
    linkValidationConcurrency: safeInt(process.env.LINK_VALIDATION_CONCURRENCY, DEFAULT_CONFIG.linkValidationConcurrency ?? 10),
    proxyUrl: process.env.PROXY_URL || DEFAULT_CONFIG.proxyUrl,
    maxDaysSinceSubUpdate: safeInt(process.env.MAX_DAYS_SINCE_SUB_UPDATE, DEFAULT_CONFIG.maxDaysSinceSubUpdate ?? 3),
    exploreFileTree: process.env.EXPLORE_FILE_TREE === 'true' || DEFAULT_CONFIG.exploreFileTree,
    logDir: process.env.LOG_DIR || DEFAULT_CONFIG.logDir,
    enableFileLog: process.env.ENABLE_FILE_LOG !== 'false',
  };
}
