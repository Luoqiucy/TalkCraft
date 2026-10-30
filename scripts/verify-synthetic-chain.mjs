// Manual paid-service test, using only the project's synthetic fixture.
import {readFile,writeFile} from 'node:fs/promises';
import {providersFromConfigPath} from '../src/file-config.mjs';
import {importPcmWav} from '../public/audio.mjs';
import {transcribeAudio} from '../src/asr.mjs';
import {processText} from '../src/pipeline.mjs';
const report={source:'Windows System.Speech / Microsoft Huihui Desktop',synthetic:true,expected:'今天的评审改到下午三点，不要改到四点，请大家提前阅读方案。',time:new Date().toISOString()};
try{
 const {provider,asr}=await providersFromConfigPath(new URL('../.local/asr-test.env',import.meta.url));
 if(provider.simulated||!asr.enabled||asr.simulated)throw new Error('需要真实语音与文字服务');
 const wav=await readFile(new URL('../reports/2026-09-15-phase1-052-synthetic.wav',import.meta.url));
 const audio=importPcmWav(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));
 const start=Date.now();report.asr=await transcribeAudio(new Uint8Array(audio.pcm),audio,asr,AbortSignal.timeout(120000));report.asrMs=Date.now()-start;
 const textStart=Date.now();report.result=await processText({mode:'dictation',text:report.asr.text},provider,AbortSignal.timeout(120000));report.textMs=Date.now()-textStart;report.totalMs=Date.now()-start;
}catch(error){report.error=error.message;process.exitCode=1;}
await writeFile(new URL('../reports/2026-09-15-phase1-052-live.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
