export function desktopExitCode(code,signal) {
  if(signal || !Number.isInteger(code) || code<0 || code>255)return 1;
  return code;
}
