import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateAsrManifest} from '../src/asr-batch.mjs';

const original=resolve('samples/phase1-mandarin-100.jsonl');
const output=resolve('samples/asr-comparison-100.jsonl');
const rows=(await readFile(original,'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
validateAsrManifest(rows);

const places=[
  '接下来七天苏州张家港市的天气怎么样？',
  '请查江苏省苏州市张家港市后天的天气，不是苏州市区。',
  '从张家港凤凰镇到南京鼓楼区需要多久？',
  '明天去江苏省昆山市花桥镇开会，上午九点到。',
  '把地址改为苏州市工业园区星湖街，不是苏州新区。',
  '我在浙江省杭州市萧山区，不在江苏省南京市。',
  '先查无锡江阴市，再查常州溧阳市，不要弄反。',
  '收货地点是上海市浦东新区张江镇，门牌号二百零八号。',
  '请确认河北省廊坊市三河市燕郊镇的地址。',
  '今天从广东省东莞市虎门镇到深圳市南山区。',
];
const long=[
  '请记录这次会议的安排。周三上午九点先在张家港召开项目评审，十点半讨论设备连接，下午两点核对预算。预算上限是二十六万元，不是二十六万五千元。会议结束后请把三项待办分别发给负责人。',
  '我再说明一遍发货要求。第一批发三百二十台，第二批发一百八十台，收货地点都是苏州市工业园区。请不要把第一批改成三百二十一台，也不要提前确认签收，等仓库核对序列号以后再更新记录。',
  '这段录音是技术说明。设备通过无线网络与桌面端通信，断线以后先在本机保留尚未提交的音频，重新连接时由用户决定是否继续。这里说的是暂存，不是自动上传。请把这两个条件分开记录，避免误解。',
  '关于下周的行程，周一在南京，周二和周三在张家港，周四回到苏州。周二下午三点与客户开会，会议地点是张家港市区，不是常熟市。请不要根据城市名称猜测具体街道，确认后再填写详细地址。',
  '请核对报价单中的数字。标准版每套一千二百八十元，专业版每套两千三百六十元，安装费单独计算。总价不能只把两个单价相加，因为订单数量还没有确认。等数量和税率都核实之后，再出正式报价。',
  '今天先讨论软件问题。用户按一次快捷键开始录音，再按一次结束录音；长按快捷键只打开帮助窗口，不应该误触发新的录音。问答模式中如果已经开始处理，下一次按键应取消当前任务，而不是切换成听写模式。',
  '我要确认一条否定指令。不要删除旧的历史记录，不要覆盖原始转录，也不要把失败的录音当成空白文件清理。允许用户自己导出音频副本，但导出的副本不属于软件内部的自动清理范围。请完整保留这些限制。',
  '天气问题需要分清时间。我问的是张家港未来七天的天气，不是今天的实时温度，也不是过去七天的观测。如果服务只返回今天和明天，就明确告诉我还缺哪些日期的数据，不要凭经验补齐后五天。',
  '这封邮件请先保存为草稿。开头感谢对方昨天提供测试设备，然后说明我们在十月三日下午完成第一轮验证，目前只发现两个待复核问题。注意这里是待复核，不代表已经确认是硬件故障，也不要直接发送给客户。',
  '最后总结本次录音。我们需要比较同一批中文语音在不同识别服务上的字错率、数字和否定词保留情况、停止后的等待时间、内存和费用。地名要包含张家港、江阴和昆山，长录音也要纳入。没有真实录音时不要用合成文本冒充测量结果。',
];

const manifest=rows.map((row,index)=>{
  let id=row.id,reference=row.reference;
  if(index>=50&&index<60){id=`places-${String(index-49).padStart(3,'0')}`;reference=places[index-50];}
  if(index>=90&&index<100){id=`long-${String(index-89).padStart(3,'0')}`;reference=long[index-90];}
  return {id,reference,audio:`comparison-audio/${id}.wav`};
});
validateAsrManifest(manifest);
await writeFile(output,manifest.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
process.stdout.write(`已生成 ${manifest.length} 条固定对比语料：${output}\n`);
