"""FDSへの明示的な接続。自動再送・転送・ローカル代替は行わない。"""
import copy
import ipaddress
import json
import socket
import urllib.request
import urllib.error
from fastapi import HTTPException

MODEL_IDS={'qwen-0.8b':'jeff-qwen-0.8b','qwen-2b':'jeff-qwen-2b','gemma-e2b':'jeff-gemma-e2b'}
API_IDS={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b','gemma-e2b':'jeff-gemma-4-e2b-it'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

class FDS:
    def __init__(self,host,port,device='auto'):
        try:
            address=ipaddress.ip_address(host)
            if address.is_unspecified or address.is_multicast:raise ValueError()
            port=int(port)
            if not 1<=port<=65535 or device not in ('auto','cpu','cuda'):raise ValueError()
        except (ValueError,TypeError):
            raise HTTPException(422,'FDSのIPアドレス・ポート・デバイスを確認してください。')
        self.url=f'http://{("["+str(address)+"]") if address.version==6 else address}:{port}'
        self.device=device

    @classmethod
    def from_request(cls,request):
        if request.headers.get('x-testjeff-backend')!='fds':return None
        return cls(request.headers.get('x-testjeff-host',''),request.headers.get('x-testjeff-port',''),request.headers.get('x-testjeff-device','auto'))

    def call(self,path,body=None):
        payload=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
        request=urllib.request.Request(self.url+path,data=payload,headers={'Content-Type':'application/json'})
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=125 if body else 8) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:detail=json.load(error).get('detail')
            except (ValueError,AttributeError):detail=None
            raise HTTPException(error.code if 400<=error.code<600 else 502,'FDS: '+(detail if isinstance(detail,str) else '要求を処理できませんでした。入力とモデルを確認してください。')) from error
        except (TimeoutError,socket.timeout) as error:
            raise HTTPException(504,'FDSの応答待ちが期限を超えました。サーバーで計算が続いている場合があります。') from error
        except (OSError,ValueError) as error:
            raise HTTPException(502,'FDSに接続できないか応答が不正です。IP・ポート・待受を確認してください。自動再送はしていません。') from error

    def status(self,selected):
        if selected not in MODEL_IDS:raise HTTPException(422,'モデルを選んでください。')
        health=self.call('/health')
        if health.get('service')!='FastDecisionServer':raise HTTPException(502,'接続先はFDSではありません。')
        capabilities=self.call('/v1/models')
        models=capabilities.get('models',[])
        model=next((m for m in models if m['id']==MODEL_IDS[selected]),None)
        if model is None:raise HTTPException(422,'指定モデルはFDSに登録されていません。')
        return {'selected':selected,'ready':bool(health.get('accepting',health.get('ready')) and model.get('available',True) and self.device in model.get('devices',[])),'models':list(MODEL_IDS),'revision':model['revision'],
                'device':self.device,'backend':'fds','endpoint':self.url,'remote_model':model['id'],
                'allocated_gib':None,'reserved_gib':None,'health':health,'devices':capabilities.get('devices',[]),
                'capabilities_version':capabilities.get('capabilities_version',0),
                'capabilities':[{**m,'local_id':next((k for k,v in MODEL_IDS.items() if v==m['id']),None)} for m in models]}

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
              'questions':questions,'images':payload.get('images',[]),'timeout_seconds':120,'priority':'normal'}
        results=[]
        for turn in range(orders):
            request=copy.deepcopy(body)
            if turn:
                for q in request['questions'].values():
                    if isinstance(q.get('criteria'),dict):q['criteria']=dict(reversed(list(q['criteria'].items())))
                    elif isinstance(q.get('criteria'),list):q['criteria'].reverse()
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
                             'revision':result.get('revision'),'request_ids':[r.get('request_id') for r in results],
                             **{k:sum(r.get(k,0) for r in results) for k in ('queue_ms','load_ms','inference_ms','total_ms')}}
        result['model']=API_IDS[selected]
        return result
