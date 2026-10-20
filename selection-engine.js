import {selectionFeatures} from './selection-features.js';
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
export const MODEL_LEAGUES={'eng.1':'en.1','eng.2':'en.2','eng.3':'en.3','eng.4':'en.4','ita.1':'it.1','ger.1':'de.1','esp.1':'es.1','fra.1':'fr.1','ned.1':'nl.1','por.1':'pt.1'};
export function inferParameters(model,features){
 if(features.some(x=>!Number.isFinite(x)))return null;
 let raw=model.intercept||model.baseline||0;
 if(model.type==='logistic')raw+=features.reduce((s,v,i)=>s+(v-model.mean[i])/model.scale[i]*model.coef[i],0);
 else for(const tree of model.trees){let i=0;while(!tree[i].is_leaf){const n=tree[i];i=features[n.feature_idx]<=n.num_threshold?n.left:n.right;}raw+=tree[i].value;}
 const p=Math.max(.000001,Math.min(.999999,sigmoid(raw))),logit=Math.log(p/(1-p));
 return sigmoid(model.calibration.coef*logit+model.calibration.intercept);
}
export function learnedSelection(artifact,validation,rows,home,away,league){
 if(!MODEL_LEAGUES[league])return {available:false,reason:'Competizione fuori dal campione del modello addestrato.'};
 const features=selectionFeatures(rows,home,away);if(!features)return {available:false,reason:'Servono almeno 6 risultati dello stesso campionato per squadra.'};
 const market='over25',v=validation.markets[market],probability=inferParameters(artifact.markets[market],features);
 return {available:true,market,probability,score:Math.round(probability*100),model:'Regressione logistica regolarizzata e calibrazione temporale',
  qualified:probability>=.7,validation:{season:validation.protocol.testSeason,count:v.testCount,thresholdSample:v.selected70.count,thresholdHits:v.selected70.hits,thresholdRate:v.selected70.hitRate,betterThanPrevious:v.betterThanPrevious,betterThanBaseline:v.betterThanBaseline,evidenceSufficient:v.selectionEvidenceSufficient},
  warning:'Selezione statistica, non garanzia di vincita. Il test ≥70% ha un campione ridotto; quote e convenienza economica non sono verificate.'};
}
export function cornerEvidence(m){
 const n=Number(m.sample)||0,h=Number(m.hits)||0;if(n<6||h<0||h>n||m.partial)return null;
 const p=h/n,z=1.645,lower=(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
 return {lower:Math.round(lower*100),eligible:lower>=.7,kind:'Limite inferiore Wilson 90% della frequenza storica; non probabilità della prossima partita.'};
}
