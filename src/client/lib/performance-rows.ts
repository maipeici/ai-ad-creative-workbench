import type { ExperimentReport } from '../types'

// Include derived versions before they receive data; use their linked test for metrics.
export function performanceRows(report:ExperimentReport|undefined,reports:ExperimentReport[]):ExperimentReport['versions']{
  if(!report)return []
  const rows=[...report.versions]
  for(const [index,child] of report.iterations.entries()){
    if(rows.some(v=>v.projectId===child.projectId))continue
    const version=reports.find(r=>r.id===child.experimentId)?.versions.find(v=>v.projectId===child.projectId)
    rows.push({...(version||{projectId:child.projectId,name:child.name,source:'iteration',available:true,videoUrl:child.videoUrl,readyShots:0,shotCount:0,staleVideo:false,staleData:false,hasData:false,adCreativeIds:[],periods:[],sources:[],totals:{impressions:0,clicks:0,conversions:0,spend:0,revenue:null},metrics:{ctr:null,cvr:null,cpa:null,roas:null}}),label:`R${index+1}`,parentProjectId:child.parentProjectId,changeSummary:child.changeSummary})
  }
  return rows
}
