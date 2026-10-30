import { createCommercialStore } from '../src/commercial/sqlite-store.mjs';
import { createCommercialGateway } from '../src/commercial/gateway.mjs';
import { loadProvider } from '../src/config.mjs';
import { loadAsr } from '../src/asr.mjs';
import { createOpenMeteoWeatherTool } from '../src/tools/weather.mjs';
import { createWebpageTool } from '../src/tools/webpage.mjs';

const dbPath = process.env.TALKCRAFT_COMMERCIAL_DB;
const port = Number(process.env.TALKCRAFT_COMMERCIAL_PORT || 4330);
const asrLimit = Number(process.env.TALKCRAFT_FREE_ASR_SECONDS);
const textLimit = Number(process.env.TALKCRAFT_FREE_AI_CHARACTERS);
if (!dbPath || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(asrLimit) || asrLimit < 0 || !Number.isSafeInteger(textLimit) || textLimit < 0) {
  throw Error('需设置独立数据库路径及显式的免费 ASR 秒数/AI 字符额度；不使用演示额度');
}
const store = createCommercialStore(dbPath);
try {
  const server = createCommercialGateway({ store, provider: loadProvider(process.env), asr: loadAsr(process.env), limits: { asr_seconds: asrLimit, ai_characters: textLimit }, weatherTool: createOpenMeteoWeatherTool(), webpageTool: createWebpageTool() });
  server.listen(port, '127.0.0.1', () => { process.stdout.write(`TalkCraft 商业网关开发服务：127.0.0.1:${port}\n`); });
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) { store.close(); throw error; }
