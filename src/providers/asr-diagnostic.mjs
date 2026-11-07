export class AsrDiagnosticError extends Error {
  constructor(message) {super(message);this.name='AsrDiagnosticError';}
}
export function noSpeechFailure() {
 const error=new AsrDiagnosticError('未识别到清晰语音：请检查所选麦克风、输入音量或远程桌面麦克风转发；可先回放录音检查，再重新录音');
 error.status=422;
 return error;
}
export function handshakeFailure(status) {
 const hint=status===401 || status===403?'请检查 API Key 或 APP ID/Access Token，以及对应项目的流式识别权限':status===429?'调用受限，请检查并发及额度':'请检查服务权限和网络';
 return new AsrDiagnosticError(`语音服务握手失败（HTTP ${status}）：${hint}`);
}
export function serviceFailure(code) {
 if(code===20000003 || code===45000002){const error=noSpeechFailure();error.message=`语音服务返回错误（代码 ${code}）：${error.message}`;return error;}
 const hints={45000001:'请求参数无效',45000002:'空音频或未检测到语音',45000081:'音频包等待超时'};
 return new AsrDiagnosticError(`语音服务返回错误（代码 ${code}）：${hints[code] || '请检查服务权限、额度和音频格式'}`);
}
