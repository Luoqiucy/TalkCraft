export class AsrDiagnosticError extends Error {
  constructor(message) {super(message);this.name='AsrDiagnosticError';}
}
export function handshakeFailure(status) {
 const hint=status===401 || status===403?'请检查 APP ID、Access Token 和2.0服务权限':status===429?'调用受限，请检查并发及额度':'请检查服务权限和网络';
 return new AsrDiagnosticError(`语音服务握手失败（HTTP ${status}）：${hint}`);
}
export function serviceFailure(code) {
 const hints={45000001:'请求参数无效',45000002:'空音频或未检测到语音',45000081:'音频包等待超时'};
 return new AsrDiagnosticError(`语音服务返回错误（代码 ${code}）：${hints[code] || '请检查服务权限、额度和音频格式'}`);
}
