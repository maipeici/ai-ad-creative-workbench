import type { ExperimentReport, Project, Shot } from '../types'

export type PerformanceVersion = ExperimentReport['versions'][number]
export type DemoIteration = { report: ExperimentReport; projects: Record<string, Project> }

// Deliberately synthetic data. It stays in component memory and is never sent
// to the project or performance APIs, including when a demo revision is made.
export function createIterationDemo(template: Project): DemoIteration {
  const shots: Shot[] = [
    ['hook', '人物痛点开场', '忙了一天，回家还要纠结怎么走？', '下班回家，少点折腾'],
    ['pain', '具体通勤场景', '背着电脑走出公司，只想早点回家。', '忙完一天，想早点回家'],
    ['product', '产品使用路径', '打开花小猪，先看预估价，再确认叫车。', '先看预估价，再叫车'],
    ['cta', '结尾行动引导', '打开花小猪，安排这趟出行。', '打开花小猪']
  ].map(([role,titleCn,vo,subtitle],i)=>({id:`demo-shot-${i}`,index:i+1,role,titleCn,vo,subtitle,durationSec:[3,4,5,3][i],personRefs:[],vehicleRefs:[],sceneRefs:[],uiRefs:[],cameraAngle:'eye level',cameraMovement:'static',action:'An office worker prepares to go home.',actionCn:i===3?'人物上车，叠加品牌标志和按钮。':'人物背着电脑包走出写字楼，低头查看手机。',prompt:'An office worker prepares to go home.',negativePrompt:'',renderMode:'overlay',overlayItems:['字幕'],factRefs:[]}))
  const seeds = [
    {id:'demo-a',label:'A',name:'人物痛点开场',impressions:400000,clicks:12000,conversions:360,spend:8000,revenue:36000},
    {id:'demo-a2',label:'A2',name:'痛点提问更直接',parent:'demo-a',change:'仅改开头',impressions:416000,clicks:16640,conversions:416,spend:8000,revenue:41600},
    {id:'demo-b',label:'B',name:'下班场景开场',impressions:300000,clicks:9000,conversions:272,spend:6000,revenue:27200},
    {id:'demo-b2',label:'B2',name:'结尾行动更明确',parent:'demo-b',change:'仅改结尾 CTA',impressions:300000,clicks:9000,conversions:328,spend:6000,revenue:32800},
    {id:'demo-c',label:'C',name:'新开头 · 小样本',impressions:12000,clicks:300,conversions:3,spend:300,revenue:300}
  ]
  const projects:Record<string,Project>={}
  const versions:PerformanceVersion[]=seeds.map(s=>{
    projects[s.id]={...structuredClone(template),id:s.id,name:s.name,creativeName:s.name,storyboard:{globalContext:{coreIdea:'下班回家，少点折腾'},shots:structuredClone(shots)},render:{model:'demo',params:{},shots:{},finalVideo:null,cover:null},experiments:[],batch:undefined,batchId:undefined,experimentLink:undefined,iteration:undefined}
    if(s.id==='demo-a2')projects[s.id].storyboard!.shots[0].vo='下班这么累，回家的路能不能省心一点？'
    if(s.id==='demo-b'||s.id==='demo-b2')projects[s.id].storyboard!.shots[0].vo='晚上十点，走出公司，终于轮到回家的时间。'
    if(s.id==='demo-c')projects[s.id].storyboard!.shots[0].vo='你下班回家的路上，最想省去哪一步？'
    if(s.id==='demo-b2')projects[s.id].storyboard!.shots[3].vo='现在打开花小猪，输入目的地，先看看预估价。'
    const {impressions,clicks,conversions,spend,revenue}=s
    return {projectId:s.id,label:s.label,name:s.name,source:'demo',available:true,readyShots:4,shotCount:4,staleVideo:false,staleData:false,hasData:true,parentProjectId:s.parent,changeSummary:s.change,adCreativeIds:[`DEMO-${s.label}`],periods:['示例同一统计区间'],sources:['虚构演示数据，非实际投放'],totals:{impressions,clicks,conversions,spend,revenue},metrics:{ctr:clicks/impressions,cvr:conversions/clicks,cpa:spend/conversions,roas:revenue/spend}}
  })
  return {projects,report:{id:'demo-performance',parentId:'demo-only',parentName:'演示体验',title:'通勤广告 · 效果与二次创作示例',mode:'comparison',variable:'multiple',primaryMetric:'cpa',hypothesis:'同一条通勤广告创意，比较开头和结尾表达，决定下一轮先改什么。',editableShotId:'demo-shot-0',editableShotIndex:1,evidence:'演示数据，仅说明操作流程。',comparable:true,plan:{audience:'城市通勤人群（示例）',budget:'同组预算一致（示例）',period:'同一统计区间（示例）',attribution:'点击归因 · 7 天窗口（示例）',trafficMethod:'observational'},versions,iterations:[],conclusion:'',nextAction:'',insights:[
    {projectId:'demo-a2',label:'A → A2',status:'hypothesis',title:'开头吸引了更多点击，承接仍值得验证',evidence:'CTR 3.00% → 4.00%；CVR 3.00% → 2.50%；CPA ¥22.22 → ¥19.23。指标变化方向并不完全一致，不能直接认定开头全面更好。',nextAction:'保留 A2 的痛点提问开头与正文，仅测试更明确的结尾 CTA，同时核对承接页面与广告承诺。',variable:'cta'},
    {projectId:'demo-b2',label:'B → B2',status:'hypothesis',title:'结尾转化表现较好，保留后继续验证',evidence:'CVR 3.02% → 3.64%；CPA ¥22.06 → ¥18.29；ROAS 4.53 → 5.47。属于同区间观察，仍需核实投放条件和分流。',nextAction:'保留 B2 的正文和结尾行动引导，仅测试新的开头口播，观察点击提升能否保留转化表现。',variable:'hook'},
    {projectId:'demo-c',label:'C',status:'observe',title:'仅 3 次转化，先继续观察',evidence:'曝光 12,000，点击 300，转化 3。转化样本较少，暂不作为本轮二次创作母版。',nextAction:'',variable:'hook'}
  ]}}
}

export function appendDemoIteration(state:DemoIteration,baseId:string,variable:string,instruction:string,changes:{actionCn:string;vo:string;subtitle:string}):DemoIteration {
  const next=structuredClone(state),base=next.projects[baseId]
  if(!base?.storyboard)throw new Error('演示母版不存在')
  const index=variable==='cta'?base.storyboard.shots.length-1:0
  const label=`R${next.report.iterations.length+1}`,id=`demo-revision-${label}`
  const draft=structuredClone(base)
  draft.id=id;draft.creativeName=`${label} · ${variable==='cta'?'结尾 CTA 迭代':'开头迭代'}`;draft.name=draft.creativeName
  Object.assign(draft.storyboard!.shots[index],changes)
  draft.iteration={parentProjectId:baseId,sourceExperimentId:next.report.id,variable,changeSummary:variable==='cta'?'仅改结尾 CTA':'仅改开头',instruction}
  next.projects[id]=draft
  const baseVersion=next.report.versions.find(v=>v.projectId===baseId)!
  next.report.versions.push({...baseVersion,projectId:id,label,name:draft.creativeName,parentProjectId:baseId,changeSummary:draft.iteration.changeSummary,readyShots:3,hasData:false,adCreativeIds:[],periods:[],sources:[],totals:{impressions:0,clicks:0,conversions:0,spend:0,revenue:null},metrics:{ctr:null,cvr:null,cpa:null,roas:null}})
  next.report.iterations.push({projectId:id,name:draft.creativeName,parentProjectId:baseId,changeSummary:draft.iteration.changeSummary,experimentId:next.report.id})
  return next
}
