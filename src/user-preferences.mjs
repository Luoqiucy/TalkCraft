import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const languages=new Set(['en','zh','zh-TW','ja','ko','fr','de','es','it','pt','ru','ar','hi','th','vi','id','ms','tr','nl','pl','uk','en-US','en-GB','pt-BR','pt-PT','zh-CN']);
export const defaultUserPreferences=()=>({schemaVersion:1,interfaceLanguage:'zh-CN',theme:'system',targetLanguage:'en',captureSounds:true,soundVolume:0.45,inputDeviceId:'',speechVoiceURI:'',speechRate:1,speechVolume:1,autoSpeakAnswers:false});
export function validateUserPreferences(value){
 if(!value||typeof value!=='object')throw new Error('设置内容无效');
 const result={...defaultUserPreferences(),...value};
 if(result.schemaVersion!==1||!['zh-CN','en-US'].includes(result.interfaceLanguage)||!['light','dark','system'].includes(result.theme)||!languages.has(result.targetLanguage)||typeof result.captureSounds!=='boolean'||!Number.isFinite(result.soundVolume)||result.soundVolume<0||result.soundVolume>1||typeof result.inputDeviceId!=='string'||result.inputDeviceId.length>512||typeof result.speechVoiceURI!=='string'||result.speechVoiceURI.length>512||!Number.isFinite(result.speechRate)||result.speechRate<0.5||result.speechRate>2||!Number.isFinite(result.speechVolume)||result.speechVolume<0||result.speechVolume>1||typeof result.autoSpeakAnswers!=='boolean')throw new Error('设置值超出允许范围');
 return {schemaVersion:1,interfaceLanguage:result.interfaceLanguage,theme:result.theme,targetLanguage:result.targetLanguage,captureSounds:result.captureSounds,soundVolume:result.soundVolume,inputDeviceId:result.inputDeviceId,speechVoiceURI:result.speechVoiceURI,speechRate:result.speechRate,speechVolume:result.speechVolume,autoSpeakAnswers:result.autoSpeakAnswers};
}
export function createUserPreferencesStore(path){
 let queue=Promise.resolve(),preserved={};const hash=text=>createHash('sha256').update(text).digest('hex');
 async function read(){try{const raw=await readFile(path,'utf8');let data;try{data=JSON.parse(raw);}catch{throw new Error('设置文件无法解析，原文件已保留');}if(data.schemaVersion===1||data.schemaVersion===undefined&&data.preferences){const known=new Set(Object.keys(defaultUserPreferences()));const extras=Object.fromEntries(Object.entries(data.preferences||{}).filter(([key])=>!known.has(key)));const topExtras=Object.fromEntries(Object.entries(data).filter(([key])=>!['schemaVersion','preferences'].includes(key)));preserved={preferences:extras,top:topExtras};return {preferences:validateUserPreferences(data.preferences),revision:hash(raw),exists:true,...(data.schemaVersion===undefined?{migrationAvailable:true}:{})};}throw new Error('设置版本不受支持，原文件已保留');}catch(error){if(error.code==='ENOENT'){preserved={preferences:{},top:{}};return {preferences:defaultUserPreferences(),revision:hash(''),exists:false};}throw error;}}
 function update(input){const run=queue.then(async()=>{const current=await read();if(!input||input.revision!==current.revision){const error=new Error('设置已在其他窗口更新，请重新读取后保存');error.status=409;throw error;}const preferences=validateUserPreferences(input.preferences);const text=JSON.stringify({...preserved.top,schemaVersion:1,preferences:{...preserved.preferences,...preferences}},null,2);try{await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,text,'utf8');await rename(`${path}.tmp`,path);}catch{throw new Error('设置保存失败；原设置仍保留');}preserved={preferences:preserved.preferences,top:preserved.top};return {preferences,revision:hash(text),exists:true};});queue=run.catch(()=>{});return run;}
 return {read,update};
}
