export function initializeModelSettings() {
const $=id=>document.getElementById(id);
if(!$('textModelForm') || $('textModelForm').dataset.initialized==='true')return;
$('textModelForm').dataset.initialized='true';
let saved,busy=false;
function fields(){const local=$('modelProvider').value==='ollama';$('modelKeyLabel').hidden=local;$('modelApiKey').required=!local&&!(saved?.provider===$('modelProvider').value&&saved.hasApiKey);$('modelKeyStatus').textContent=local?'需先启动本机 Ollama 并下载模型':saved?.provider===$('modelProvider').value&&saved.hasApiKey?'密钥已保存；留空保留原密钥，填写则替换':'尚未保存此提供商的密钥';}
function lock(value){busy=value;for(const id of ['modelProvider','modelName','modelApiKey','saveTextModel','reloadTextModel'])$(id).disabled=value;$('saveTextModel').disabled=value||!saved;}
async function request(options){const response=await fetch('/api/text-settings',{...options,signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'配置请求失败');return data;}
async function read(){if(busy)return;lock(true);$('textModelStatus').textContent='读取配置中…';try{saved=await request();if(saved.provider!=='mock')$('modelProvider').value=saved.provider;$('modelName').value=saved.model;$('modelApiKey').value='';fields();$('textModelStatus').textContent=saved.provider==='mock'?'当前为模拟模式，请填写真实模型配置':'已读取配置；尚未验证模型实际响应';}catch(error){saved=undefined;$('textModelStatus').textContent=`读取失败：${error.message}；填写内容已保留，请重新读取后保存`;}finally{lock(false);}}
$('modelProvider').addEventListener('change',()=>{$('modelName').value=saved?.provider===$('modelProvider').value?saved.model:'';$('modelApiKey').value='';fields();});
$('reloadTextModel').addEventListener('click',read);
$('saveTextModel').addEventListener('click',async()=>{if(busy||!saved)return;if(!$('modelName').reportValidity()||!$('modelApiKey').reportValidity())return;lock(true);$('textModelStatus').textContent='保存配置中…';try{saved=await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:saved.revision,provider:$('modelProvider').value,model:$('modelName').value,apiKey:$('modelApiKey').value})});$('modelApiKey').value='';fields();window.dispatchEvent(new Event('text-service-changed'));$('checkService').click();$('textModelStatus').textContent='已保存并启用；前往工作台输入文字测试。云端处理仍需确认文字上传。';}catch(error){$('textModelStatus').textContent=`保存失败：${error.message}；可重新读取后重试`;}finally{lock(false);}});
read();
}

