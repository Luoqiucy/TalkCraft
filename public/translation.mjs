const languageLabels={en:'英语','en-US':'美式英语','en-GB':'英式英语',zh:'简体中文','zh-CN':'简体中文（中国大陆）','zh-TW':'繁体中文',ja:'日语',ko:'韩语',fr:'法语',de:'德语',es:'西班牙语',it:'意大利语',pt:'葡萄牙语','pt-BR':'巴西葡萄牙语','pt-PT':'葡萄牙葡萄牙语',ru:'俄语',ar:'阿拉伯语',hi:'印地语',th:'泰语',vi:'越南语',id:'印度尼西亚语',ms:'马来语',tr:'土耳其语',nl:'荷兰语',pl:'波兰语',uk:'乌克兰语'};
export function translationDocument(result) {
  if(!result || result.mode!=='translate' || !languageLabels[result.targetLanguage] || typeof result.input!=='string' || !result.input.trim() || typeof result.output!=='string' || !result.output.trim() || typeof result.simulated!=='boolean') throw new Error('没有可导出的完整翻译结果');
  const label=languageLabels[result.targetLanguage];
  return `${result.simulated?'【模拟结果：未调用真实翻译服务】\n\n':''}原文\n${result.input}\n\n译文（${label}）\n${result.output}\n`;
}
export function createTranslationActions({clipboard,download,notify}) {
  let result;
  return {
    set(value){try{translationDocument(value);result={mode:value.mode,targetLanguage:value.targetLanguage,input:value.input,output:value.output,simulated:value.simulated};}catch{result=undefined;}return !!result;},
    clear(){result=undefined;},
    get ready(){return !!result;},
    async copy(){try{if(!result)throw new Error('请先生成翻译结果');const text=translationDocument(result);await clipboard(text);notify('已复制本次原文与译文');return true;}catch(error){notify(`双语复制失败：${error.message}`);return false;}},
    export(){try{if(!result)throw new Error('请先生成翻译结果');download(translationDocument(result),`talkcraft-translation-${result.targetLanguage}.txt`);notify('已导出本次双语文本，不包含音频');return true;}catch(error){notify(`导出失败：${error.message}`);return false;}}
  };
}
