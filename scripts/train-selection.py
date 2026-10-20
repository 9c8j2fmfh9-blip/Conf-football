"""Reproducible temporal model selection, calibration and external-season evaluation.
scikit-learn is BSD-3-Clause; only numerical parameters are used at runtime.
"""
import json,datetime
import numpy as np
import sklearn,scipy
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss,log_loss
from scipy.special import logit,expit
from pathlib import Path
root=Path(__file__).resolve().parent.parent
data=json.load(open('/tmp/conf-selection-cases.json'))
train=data['seasons']['2023-24'];validation=[r for r in data['seasons']['2024-25'] if r['date']<'2025-02-01'];calibration=[r for r in data['seasons']['2024-25'] if r['date']>='2025-02-01'];test=data['seasons']['2025-26']
X=lambda rows:np.asarray([r['features'] for r in rows],dtype=float)
artifact={'version':'1.0','featureNames':data['featureNames'],'trainedSeason':'2023-24','selectionPeriod':'2024-07-01/2025-01-31','calibrationPeriod':'2025-02-01/2025-06-30','testSeason':'2025-26','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'trainingSoftware':{'numpy':np.__version__,'scikit-learn':sklearn.__version__,'scipy':scipy.__version__},'markets':{}}
report={'protocol':{'training':len(train),'selection':len(validation),'calibration':len(calibration),'test':len(test),'testSeason':'2025-26','timeOrder':'Features use only strictly earlier dates within each season. No test-season outcomes are used for fitting, model selection or calibration.','source':'OpenFootball CC0; live inference uses ESPN, which requires separate forward monitoring.'},'markets':{}}
goldens={}
for j,key in enumerate(['over25','btts']):
 y=lambda rows:np.asarray([r['truth'][j] for r in rows])
 candidates={
  'logistic-C0.1':make_pipeline(StandardScaler(),LogisticRegression(C=.1,max_iter=1000,random_state=17)),
  'logistic-C1':make_pipeline(StandardScaler(),LogisticRegression(C=1,max_iter=1000,random_state=17)),
  'hist-gradient-boosting':HistGradientBoostingClassifier(max_iter=100,max_leaf_nodes=7,learning_rate=.05,l2_regularization=10,min_samples_leaf=50,random_state=17)}
 scores={}
 for name,m in candidates.items():
  m.fit(X(train),y(train));scores[name]=float(brier_score_loss(y(validation),m.predict_proba(X(validation))[:,1]))
 best=min(scores,key=scores.get)
 # Prefer a simpler logistic model if development Brier differs by at most .002.
 simple=min([k for k in scores if k.startswith('logistic')],key=scores.get)
 if scores[simple]<=scores[best]+.002:best=simple
 model=candidates[best]
 raw=np.clip(model.predict_proba(X(calibration))[:,1],1e-6,1-1e-6)
 cal=LogisticRegression(C=1,max_iter=1000).fit(logit(raw).reshape(-1,1),y(calibration))
 prob=cal.predict_proba(logit(np.clip(model.predict_proba(X(test))[:,1],1e-6,1-1e-6)).reshape(-1,1))[:,1]
 if best.startswith('logistic'):
  scaler,clf=model.steps[0][1],model.steps[1][1]
  exported={'type':'logistic','mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'coef':clf.coef_[0].tolist(),'intercept':float(clf.intercept_[0])}
 else:
  trees=[]
  for predictor in model._predictors:
   nodes=predictor[0].nodes
   trees.append([{n:(float(row[n]) if n in ['value','num_threshold'] else int(row[n])) for n in ['value','feature_idx','num_threshold','left','right','is_leaf','missing_go_to_left']} for row in nodes])
  exported={'type':'hist-gradient-boosting','baseline':float(model._baseline_prediction[0,0]),'trees':trees}
 exported['calibration']={'coef':float(cal.coef_[0,0]),'intercept':float(cal.intercept_[0])};artifact['markets'][key]=exported
 yt=y(test);baseline=np.asarray([r['baseline'][j] for r in test]);old=np.asarray([r['poisson'][key] for r in test]);selected=prob>=.7;n=int(selected.sum());hits=int(yt[selected].sum())
 z=1.96;p=hits/n if n else None;lower=(p+z*z/(2*n)-z*np.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n) if n else None
 bins=[]
 for lo,hi in [(0,.5),(.5,.6),(.6,.7),(.7,.8),(.8,1.00001)]:
  mask=(prob>=lo)&(prob<hi);bins.append({'from':lo,'to':min(1,hi),'count':int(mask.sum()),'predicted':float(prob[mask].mean()) if mask.any() else None,'observed':float(yt[mask].mean()) if mask.any() else None})
 metrics={'model':best,'developmentBrier':scores,'testCount':len(test),'brier':float(brier_score_loss(yt,prob)),'baselineBrier':float(brier_score_loss(yt,baseline)),'previousModelBrier':float(brier_score_loss(yt,old)),'logLoss':float(log_loss(yt,prob)),'selected70':{'count':n,'hits':hits,'hitRate':p,'wilson95Lower':float(lower) if lower is not None else None},'calibration':bins}
 metrics['betterThanBaseline']=metrics['brier']<metrics['baselineBrier'];metrics['betterThanPrevious']=metrics['brier']<metrics['previousModelBrier']
 metrics['selectionEvidenceSufficient']=metrics['betterThanBaseline'] and n>=50 and p is not None and p>=.7
 report['markets'][key]=metrics
 goldens[key]=[{'features':test[int(i)]['features'],'expected':float(prob[int(i)])} for i in [0,1,int(np.argmax(prob)),int(np.argmin(prob))]]
print(json.dumps(report,indent=2))
(root/'selection-model.json').write_text(json.dumps(artifact,separators=(',',':'))+'\n')
(root/'selection-validation.json').write_text(json.dumps(report,indent=2)+'\n')

(root/'selection-inference-cases.json').write_text(json.dumps(goldens,indent=2)+'\n')
