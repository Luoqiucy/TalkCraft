import { createRoot } from 'react-dom/client';
import './style.css';

const plans = [
  { name: 'Free', eyebrow: '轻量体验', price: '¥0', cycle: '正式开放后免费使用', description: '适合偶尔口述和体验核心流程。', features: ['基础语音转写', '听写、提示词预设、翻译与问答', '本机历史与录音保存设置'], action: '账号功能尚未开放', featured: false },
  { name: 'Pro', eyebrow: '日常高频使用', price: '价格待公布', cycle: '月付与年付方案待确定', description: '计划提供更高的语音和问答额度。', features: ['包含 Free 的核心功能', '更高的转写与 AI 处理额度', '由 TalkCraft 托管供应商 API'], action: '订阅尚未开放', featured: true },
  { name: 'Team', eyebrow: '团队方案', price: '后续规划', cycle: '具体范围与价格待确定', description: '团队管理与集中结算将在个人版稳定后评估。', features: ['成员与额度管理：规划中', '集中结算：规划中', '组织级管理能力：规划中'], action: '暂未开放', featured: false },
];

const features = [
  { group: '核心使用', rows: [
    ['语音转文字', '开发版已支持', '计划包含', '待规划'],
    ['提示词预设与翻译', '开发版已支持', '计划包含', '待规划'],
    ['联网问答与来源', '开发版已支持', '计划包含', '待规划'],
    ['本机历史与录音控制', '开发版已支持', '计划包含', '待规划'],
  ] },
  { group: '账号与额度', rows: [
    ['TalkCraft 账号', '开发中', '开发中', '待规划'],
    ['每期转写额度', '额度待公布', '更高额度，待公布', '待规划'],
    ['每期 AI 问答额度', '额度待公布', '更高额度，待公布', '待规划'],
    ['无需自行填写供应商 API', '网关接通后提供', '网关接通后提供', '待规划'],
  ] },
  { group: '购买与管理', rows: [
    ['在线购买与续费', '不适用', '尚未开放', '待规划'],
    ['取消与退款规则', '不适用', '收费前公布', '待规划'],
    ['团队成员与集中结算', '不适用', '不适用', '待规划'],
  ] },
];

const questions = [
  ['现在能购买 Pro 吗？', '暂时不能。账号、服务端用量核算和支付仍在开发中；页面是套餐结构预览，不接受付款。'],
  ['Free 会有多少额度？', '具体额度尚未确定。我们会在公开购买前说明计量单位、周期、重置时间和用尽后的处理方式。'],
  ['升级后还要填写自己的 API Key 吗？', '目标是不需要。商业版将由 TalkCraft 的服务端管理供应商调用；目前开发版仍使用本机配置，两者不会混为已上线功能。'],
  ['现在软件里的“本机统计”是会员额度吗？', '不是。本机统计只记录本机成功任务的数量，不可用作订阅余额或扣费依据；正式额度必须由服务端确认。'],
  ['录音和历史会自动上传吗？', '不会因为浏览此页面或未来登录就自动同步本机历史。主动使用云端识别、模型和联网工具时，对应音频或文字会发送至所选服务；正式商业版的数据说明将在上线前公布。'],
  ['如何取消订阅？', '订阅尚未开放。收费前会提供明确的取消入口、续费说明和退款规则。'],
];

function App() {
  return <>
    <header className="site-header"><div className="container header-inner"><a className="brand" href="#top" aria-label="TalkCraft 返回顶部"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>TalkCraft</span></a><nav aria-label="页面导航"><a href="#plans">套餐</a><a href="#compare">功能对比</a><a href="#faq">常见问题</a></nav><span className="header-label">商业版预览</span></div></header>
    <main id="top">
      <section className="hero container" aria-labelledby="hero-title"><div className="preview-pill"><span /> 套餐方案预览 · 暂未开放购买</div><h1 id="hero-title">让想法自然说出来。<br /><em>让工作顺畅写下去。</em></h1><p>从简单听写到联网问答，TalkCraft 计划让不同使用频率的人都能找到合适的方案。正式价格、额度和支付规则将在上线前公布。</p></section>
      <section className="container" id="plans" aria-labelledby="plans-title"><div className="section-heading"><span className="section-kicker">PLANS</span><h2 id="plans-title">选择适合自己的方式</h2><p>下面展示目标套餐结构。当前开发版尚不提供注册、会员或在线支付。</p></div><div className="plan-grid">{plans.map(plan => <article className={`plan-card${plan.featured ? ' featured' : ''}`} key={plan.name}><div className="plan-top"><span className="plan-eyebrow">{plan.eyebrow}</span>{plan.featured && <span className="plan-badge">规划重点</span>}</div><h3>{plan.name}</h3><p className="plan-description">{plan.description}</p><div className="plan-price">{plan.price}</div><p className="plan-cycle">{plan.cycle}</p><button type="button" disabled aria-label={`${plan.name}：${plan.action}`}>{plan.action}</button><p className="plan-includes">方案目标</p><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul></article>)}</div><p className="plan-note">套餐名称和权益可调整。不会在价格、用量口径与取消规则未公布前收款。</p></section>
      <section className="comparison" id="compare" aria-labelledby="compare-title"><div className="container"><div className="section-heading"><span className="section-kicker">COMPARE</span><h2 id="compare-title">功能与开放状态</h2><p>“开发版已支持”指现有桌面开发版能力；账号和付费权益仍在开发。</p></div><div className="table-scroll" role="region" aria-label="套餐功能对比，可横向滚动" tabIndex={0}><table><thead><tr><th scope="col">功能</th><th scope="col">Free</th><th scope="col" className="pro-col">Pro</th><th scope="col">Team</th></tr></thead><tbody>{features.flatMap(group => [<tr className="group-row" key={group.group}><th scope="rowgroup" colSpan={4}>{group.group}</th></tr>, ...group.rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th><td>{row[1]}</td><td className="pro-col">{row[2]}</td><td>{row[3]}</td></tr>)])}</tbody></table></div></div></section>
      <section className="faq container" id="faq" aria-labelledby="faq-title"><div className="section-heading"><span className="section-kicker">FAQ</span><h2 id="faq-title">常见问题</h2></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    </main>
    <footer className="site-footer"><div className="container footer-inner"><div><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>TalkCraft</span></div><p>桌面语音助手 · 商业方案预览</p></div><div><strong>当前状态</strong><p>尚未开放账号与订阅</p><p>正式服务条款和隐私说明将于收费前提供</p></div></div></footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
