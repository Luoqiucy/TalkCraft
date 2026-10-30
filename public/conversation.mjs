const MAX_MESSAGES=12, MAX_TEXT=4000, MAX_TOTAL=8000;
export function validateHistory(history=[]) {
  if(!Array.isArray(history) || history.length>MAX_MESSAGES || history.length%2) throw new Error('问答历史格式无效');
  let total=0;
  const normalized=history.map((message,index) => {
    if(!message || message.role!==(index%2===0 ? 'user' : 'assistant') || typeof message.content!=='string' || !message.content.trim() || message.content.length>MAX_TEXT) throw new Error('问答历史必须是完整的用户与助手消息对');
    total+=message.content.length;return {role:message.role,content:message.content};
  });
  if(total>MAX_TOTAL) throw new Error('问答历史内容过长');return normalized;
}
export function createConversation() {
  let history=[];
  return {
    get history(){return history.map(message => ({...message}));},
    clear(){history=[];},
    addTurn(question,answer) {
      if(typeof question!=='string' || typeof answer!=='string' || !question.trim() || !answer.trim() || question.length>MAX_TEXT || answer.length>MAX_TEXT) {history=[];return false;}
      history.push({role:'user',content:question},{role:'assistant',content:answer});
      while(history.length>MAX_MESSAGES || history.reduce((sum,m) => sum+m.content.length,0)>MAX_TOTAL) history.splice(0,2);
      return true;
    }
  };
}
