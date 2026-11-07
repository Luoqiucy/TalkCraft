import { getJson, postJson } from './apiClient';
export type UserPreferences={schemaVersion:1;interfaceLanguage:'zh-CN'|'en-US';theme:'light'|'dark'|'system';targetLanguage:string;captureSounds:boolean;soundVolume:number;inputDeviceId:string;speakerSuppression:boolean;speechVoiceURI:string;speechRate:number;speechVolume:number;autoSpeakAnswers:boolean};
export type UserPreferencesSnapshot={preferences:UserPreferences;revision:string;exists:boolean;migrationAvailable?:boolean};
export const defaultUserPreferences:UserPreferences={schemaVersion:1,interfaceLanguage:'zh-CN',theme:'system',targetLanguage:'en',captureSounds:true,soundVolume:.45,inputDeviceId:'',speakerSuppression:false,speechVoiceURI:'',speechRate:1,speechVolume:1,autoSpeakAnswers:false};
export const readUserPreferences=()=>getJson<UserPreferencesSnapshot>('/api/user-preferences');
export const saveUserPreferences=(revision:string,preferences:UserPreferences)=>postJson<UserPreferencesSnapshot>('/api/user-preferences',{revision,preferences});
