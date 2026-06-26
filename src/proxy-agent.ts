import http from 'http';
import https from 'https';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require('https-proxy-agent') as { HttpsProxyAgent: any };

let cachedAgent: any = null;
let cachedProxyUrl: string | undefined;

export function getProxyAgents(proxyUrl?: string): { httpAgent?: http.Agent; httpsAgent?: https.Agent } {
  if (!proxyUrl) {
    cachedAgent = null;
    cachedProxyUrl = undefined;
    return {};
  }

  if (cachedAgent && cachedProxyUrl === proxyUrl) {
    return {
      httpAgent: cachedAgent as unknown as http.Agent,
      httpsAgent: cachedAgent,
    };
  }

  cachedAgent = new HttpsProxyAgent(proxyUrl);
  cachedProxyUrl = proxyUrl;

  return {
    httpAgent: cachedAgent as unknown as http.Agent,
    httpsAgent: cachedAgent,
  };
}
