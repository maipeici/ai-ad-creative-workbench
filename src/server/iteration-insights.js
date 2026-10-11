// Descriptive, deterministic suggestions. These thresholds are observation
// guardrails, not statistical significance tests or proof of attribution.
export function iterationInsights(report) {
  const baseline = report.versions[0]
  const pct = n => (n * 100).toFixed(2) + '%'
  const enough = v => v.totals.impressions >= 1000 && v.totals.clicks >= 100 && (report.primaryMetric === 'ctr' || v.totals.conversions >= 20)
  return report.versions.map(v => {
    const result = { projectId:v.projectId, label:v.label, status:'observe', title:'继续收集数据', evidence:'', nextAction:'', variable:'hook' }
    if (v.staleData || v.staleVideo) return {...result,status:'stale',title:'数据与当前视频不一致',evidence:'原始结果保留，请重新关联当前成片的数据后再判断。'}
    if (!v.hasData) return {...result,title:'等待投放结果',evidence:'导入这条视频的素材 ID、统计区间和效果数据。'}
    if (!enough(v)) return {...result,title:'样本较少，继续观察',evidence:`曝光 ${v.totals.impressions}、点击 ${v.totals.clicks}、转化 ${v.totals.conversions}。尚未达到本页观察门槛，暂不据此筛选优胜素材。`}
    if (v.projectId === baseline.projectId || !baseline.hasData || baseline.staleData || !enough(baseline) || [...v.periods].sort().join() !== [...baseline.periods].sort().join()) return {...result,title:'建立可比版本后再判断方向',evidence:`当前 CTR ${pct(v.metrics.ctr)}，CVR ${v.metrics.cvr===null?'—':pct(v.metrics.cvr)}；需要同区间的另一条素材作为参照。`,nextAction:'保持正文和结尾不变，只测试一种新的开头表达。'}
    const ctrUp=v.metrics.ctr>baseline.metrics.ctr, ctrDown=v.metrics.ctr<baseline.metrics.ctr
    const conversionReady=v.totals.conversions>=20&&baseline.totals.conversions>=20
    const cvrDown=conversionReady&&v.metrics.cvr<baseline.metrics.cvr
    let variable='hook', nextAction='保持正文和结尾不变，只测试一种新的开头表达。'
    if(ctrUp&&cvrDown){variable='cta';nextAction='先核查素材承诺与落地页是否一致；若继续做素材测试，保留开头和正文，仅测试结尾行动引导。'}
    else if(!ctrDown&&conversionReady){variable='cta';nextAction='保留开头和正文，仅测试更明确的结尾行动引导；对照转化率与转化成本。'}
    const evidence=`相较 ${baseline.label}：CTR ${pct(baseline.metrics.ctr)} → ${pct(v.metrics.ctr)}`+(conversionReady?`；CVR ${pct(baseline.metrics.cvr)} → ${pct(v.metrics.cvr)}`:'；转化样本不足，暂不解释转化差异')+'。'+(report.mode==='single-variable'?'仍需核实投放条件与分流。':'多个因素可能同时变化，不能归因到单一镜头。')
    return {...result,status:'hypothesis',title:'可验证的下一轮假设',evidence,nextAction,variable}
  })
}
