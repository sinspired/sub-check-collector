import * as fs from 'fs/promises';
import { ConfigUpdater } from './src/config-updater';
import { SubscriptionLink } from './src/types';

async function main() {
  const content = await fs.readFile('./output/subscriptions.md', 'utf-8');
  const lines = content.split('\n');
  const headerIdx = lines.findIndex(l => l.includes('纯链接列表'));
  if (headerIdx === -1) { console.error('未找到纯链接列表'); process.exit(1); }
  const startIdx = lines.indexOf('```', headerIdx);
  const endIdx = lines.indexOf('```', startIdx + 1);
  if (startIdx === -1 || endIdx === -1) { console.error('代码块标记不完整'); process.exit(1); }
  const urls = lines.slice(startIdx + 1, endIdx).map(l => l.trim()).filter(l => l.startsWith('http'));
  console.log(`从 subscriptions.md 提取到 ${urls.length} 个链接`);

  const links: SubscriptionLink[] = urls.map(url => ({ url, source: 'collector', foundAt: new Date() }));
  const updater = new ConfigUpdater('./config.yaml');
  await updater.backupConfig();
  await updater.updateSubUrls(links);
}

main().catch(e => { console.error(e); process.exit(1); });
