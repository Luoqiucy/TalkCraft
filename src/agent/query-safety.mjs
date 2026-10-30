// Conservative pre-search checks for speech transcripts. This does not try to
// guess a correction; it only prevents an obviously malformed key entity from
// being sent to a weather or web search tool.
const leadingSpeechFragments = /^(?:是|嗯|呃|啊|那个|这个|然后|就是)\s*/;
const trailingSpeechFragments = /(?:吧|呀|啊|呃|那个)$/;
const temporalOnlyLocation = /^(?:接下来|未来|明天|明日|后天|今天|今日|本周|这周|这一周|一周|七天|7天|[2-7]\s*天)/u;

export function assessSearchEntity({ intent, location } = {}) {
  if (intent !== 'weather') return { safe: true };
  if (typeof location !== 'string' || !location.trim()) return { safe: false, reason: '我还没有可靠确定天气地点，请确认城市或地区名称后再查询。' };
  const value = location.trim();
  if (temporalOnlyLocation.test(value)) return { safe: false, reason: `我听到的“${value}”像日期范围或识别残片，不是可确认的城市；请补充天气地点。` };
  if (leadingSpeechFragments.test(value)) return { safe: false, reason: `我听到的地点可能是“${value}”，请确认正确的城市或地区名称。` };
  if (trailingSpeechFragments.test(value) || /(?:怎么样|如何|天气|预报|温度)/.test(value)) return { safe: false, reason: `地点“${value}”似乎包含了语音残片，请确认正确的城市或地区名称。` };
  if (value.length > 12) return { safe: false, reason: `地点“${value}”过长，可能是语音识别混入了其他内容，请确认正确的城市或地区名称。` };
  return { safe: true };
}
