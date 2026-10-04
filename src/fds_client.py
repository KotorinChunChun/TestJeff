"""FDSへの明示的な接続。自動再送・転送・ローカル代替は行わない。"""
import copy
import ipaddress
import json
import socket
import urllib.request
import urllib.error
from fastapi import HTTPException
from reproduction import reproduction, safe_request, safe_metadata

MODEL_IDS={'qwen-0.8b':'jeff-qwen-0.8b','qwen-2b':'jeff-qwen-2b','gemma-e2b':'jeff-gemma-e2b'}
API_IDS={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b','gemma-e2b':'jeff-gemma-4-e2b-it'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

class FDS:
    def __init__(self,host,port,device='auto',auto_unload=True):
        try:
            address=ipaddress.ip_address(host)
            if address.is_unspecified or address.is_multicast:raise ValueError()
            port=int(port)
            if not 1<=port<=65535 or device not in ('auto','cpu','cuda') or type(auto_unload) is not bool:raise ValueError()
        except (ValueError,TypeError):
            raise HTTPException(422,'FDSのIPアドレス・ポート・デバイスを確認してください。')
        self.url=f'http://{("["+str(address)+"]") if address.version==6 else address}:{port}'
        self.device=device
        self.auto_unload=auto_unload

    @classmethod
    def from_request(cls,request):
        if request.headers.get('x-testjeff-backend')!='fds':return None
        automatic=request.headers.get('x-testjeff-auto-unload','true')
        if automatic not in ('true','false'):raise HTTPException(422,'自動アンロードにはtrueまたはfalseを指定してください。')
        return cls(request.headers.get('x-testjeff-host',''),request.headers.get('x-testjeff-port',''),request.headers.get('x-testjeff-device','auto'),automatic=='true')

    def call(self,path,body=None):
        payload=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
        request=urllib.request.Request(self.url+path,data=payload,headers={'Content-Type':'application/json'})
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=305 if path.startswith('/models/') and body else 125 if body else 8) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                data=json.load(error)
                detail=data.get('detail') or data.get('error')
            except (ValueError,AttributeError):detail=None
            # 承認対象と期限をクライアントへ渡す。ここでは承認・再送をしない。
            if not isinstance(detail,dict):detail='FDS: '+(detail if isinstance(detail,str) else '要求を処理できませんでした。入力とモデルを確認してください。')
            raise HTTPException(error.code if 400<=error.code<600 else 502,detail) from error
        except (TimeoutError,socket.timeout) as error:
            raise HTTPException(504,'FDSの応答待ちが期限を超えました。サーバーで計算が続いている場合があります。') from error
        except (OSError,ValueError) as error:
            raise HTTPException(502,'FDSに接続できないか応答が不正です。IP・ポート・待受を確認してください。自動再送はしていません。') from error

    def models(self):
        health=self.call('/health')
        if health.get('service')!='FastDecisionServer':raise HTTPException(502,'接続先はFDSではありません。')
        capabilities=self.call('/v1/models')
        rows=capabilities.get('models',capabilities.get('data',[]))
        if not isinstance(rows,list):raise HTTPException(502,'FDSのモデル一覧が不正です。')
        return {**capabilities,'backend':'fds','endpoint':self.url,'health':health,
                'capabilities':[{**m,'local_id':next((k for k,v in MODEL_IDS.items() if v==m.get('id')),None)} for m in rows]}

    def manage(self,action,body):
        if action not in ('load','unload') or not isinstance(body,dict):raise HTTPException(422,'モデル管理要求が不正です。')
        if not set(body)<= {'model','device','auto_unload','approval_token','timeout_seconds'}:raise HTTPException(422,'モデル管理要求に未対応の項目があります。')
        payload=copy.deepcopy(body)
        model=payload.get('model')
        if not isinstance(model,str) or not model or len(model)>100:raise HTTPException(422,'モデルを指定してください。')
        payload['model']=MODEL_IDS.get(model,model)
        payload.setdefault('device',self.device)
        payload.setdefault('auto_unload',self.auto_unload)
        payload.setdefault('timeout_seconds',120)
        return self.call('/models/'+action,payload)

    def load(self,selected,body=None):
        if selected not in MODEL_IDS:raise HTTPException(422,'モデルを選んでください。')
        payload=dict(body or {})
        payload['model']=selected
        operation=self.manage('load',payload)
        status=self.status(selected)
        status['management']=operation
        return status

    def status(self,selected):
        if selected not in MODEL_IDS:raise HTTPException(422,'モデルを選んでください。')
        capabilities=self.models()
        health=capabilities['health']
        models=capabilities.get('models',capabilities.get('data',[]))
        model=next((m for m in models if m['id']==MODEL_IDS[selected]),None)
        if model is None:raise HTTPException(422,'指定モデルはFDSに登録されていません。')
        resolved=self.device
        if resolved=='auto':resolved=capabilities.get('default_device',health.get('default_device','auto'))
        if resolved=='auto':resolved='cuda' if 'cuda' in capabilities.get('devices',[]) else 'cpu'
        capable=bool(model.get('loadable',model.get('available',True)) and self.device in model.get('devices',[]))
        loaded=resolved in model.get('loaded_devices',[]) if capabilities.get('capabilities_version',0)>=2 else capable
        return {'selected':selected,'ready':bool(health.get('accepting',health.get('ready')) and loaded),'loadable':capable,'models':list(MODEL_IDS),'revision':model['revision'],
                'device':self.device,'default_device':capabilities.get('default_device',health.get('default_device','auto')),
                'backend':'fds','endpoint':self.url,'remote_model':model['id'],
                'allocated_gib':None,'reserved_gib':None,'health':health,'devices':capabilities.get('devices',[]),
                'capabilities_version':capabilities.get('capabilities_version',0),
                'loaded_models':capabilities.get('loaded_models',[]),'generation':capabilities.get('generation'),
                'model_management':capabilities.get('model_management'), 'capabilities':capabilities['capabilities']}

    def predict(self,payload,selected):
        if selected not in MODEL_IDS:raise HTTPException(422,'モデルを選んでください。')
        original=payload['questions']; orders=payload.get('orders',1)
        if type(orders) is not int or orders not in (1,2):raise HTTPException(422,'ordersは1または2です。')
        # FDSのchoice IDは数字だけを許可しないため、全IDを一意な内部IDへ変換する。
        questions=copy.deepcopy(original); mappings={}
        for key,q in questions.items():
            if q['type']=='noul' and orders==2:
                q['type']='choice';q['criteria']={'false':(q.get('criteria') or {}).get('false','いいえ'),'true':(q.get('criteria') or {}).get('true','はい')}
            if not isinstance(q.get('instructions'),str):q['instructions']=json.dumps(q.get('instructions',''),ensure_ascii=False)
            if q['type']=='choice':
                mappings[key]={f'option_{i}':name for i,name in enumerate(q['criteria'])}
                q['criteria']={ident:description if isinstance(description,str) else json.dumps(description,ensure_ascii=False) for ident,description in zip(mappings[key],q['criteria'].values())}
        state=payload.get('state','')
        body={'model':MODEL_IDS[selected],'device':self.device,'state':state if isinstance(state,str) else json.dumps(state,ensure_ascii=False),
              'questions':questions,'images':payload.get('images',[]),'timeout_seconds':120,'priority':'normal','auto_unload':self.auto_unload}
        results=[]; submitted=[]
        for turn in range(orders):
            request=copy.deepcopy(body)
            if turn:
                for q in request['questions'].values():
                    if isinstance(q.get('criteria'),dict):q['criteria']=dict(reversed(list(q['criteria'].items())))
                    elif isinstance(q.get('criteria'),list):q['criteria'].reverse()
            submitted.append(safe_request(request, jev_defaults=False))
            result=self.call('/v1/decisions',request)
            if result.get('model')!=MODEL_IDS[selected] or not isinstance(result.get('answers'),dict):raise HTTPException(502,'FDSのモデルまたは応答が一致しません。')
            for key,answer in result['answers'].items():
                if key in mappings:
                    answer['probabilities']={mappings[key][ident]:value for ident,value in answer['probabilities'].items()}
                    answer['choice']=mappings[key][answer['choice']]
                    if original[key]['type']=='noul':result['answers'][key]={'type':'noul','noul':answer['probabilities']['true']}
                elif turn and answer['type']=='score':
                    n=len(original[key]['criteria']);answer['probabilities']={str(n-1-int(ident)):value for ident,value in answer['probabilities'].items()}
            results.append(result)
        result=results[0]
        if orders==2:
            from jeff.model import answer as make_answer, options
            for key,q in original.items():
                if q['type']=='noul':result['answers'][key]['noul']=sum(r['answers'][key]['noul'] for r in results)/2
                else:
                    keys,_=options(q)
                    result['answers'][key]=make_answer(q,[sum(r['answers'][key]['probabilities'][k] for r in results)/2 for k in keys])
        result['execution']={'backend':'fds','endpoint':self.url,'model':MODEL_IDS[selected],'device':result.get('device'),
                             'requested_device':self.device,'orders':orders,'timeout_seconds':120,'priority':'normal','auto_unload':self.auto_unload,
                             'revision':result.get('revision'),'request_ids':[r.get('request_id') for r in results],
                             'management_steps':[safe_metadata(r.get('management')) for r in results],
                             **{k:sum(r.get(k,0) for r in results) for k in ('queue_ms','load_ms','inference_ms','total_ms')}}
        input_tokens = [r.get('usage', {}).get('input_tokens') for r in results]
        result['execution']['input_tokens'] = (sum(input_tokens) if all(type(n) is int and n >= 0 for n in input_tokens) else None)
        result['model']=API_IDS[selected]
        result['reproduction']=reproduction(payload,result['execution'])
        result['reproduction']['submitted_requests']=submitted
        return result
