/* 自由入力を維持し、常に全候補を表示する編集可能コンボ。 */
(()=>{
'use strict';
let sequence=0,opened=null;
const style=document.createElement('style');
style.textContent='.noun-combo{display:inline-flex;align-items:stretch;max-width:100%;border:1px solid #cbd8cd;border-radius:7px;background:white;overflow:hidden}.noun-combo:focus-within{outline:2px solid #326ba8;outline-offset:1px}.noun-combo input{border:0;border-radius:0;outline:none;min-width:0;background:transparent}.noun-combo button{width:27px;flex:0 0 27px;padding:0;border:0;border-radius:0;background:transparent}.noun-combo:has(input:disabled){opacity:.6}.noun-combo-popup{position:fixed;z-index:1100;background:white;color:#23362c;border:1px solid #9aae9d;border-radius:7px;box-shadow:0 8px 24px #23362c30;overflow-y:auto;overscroll-behavior:contain;padding:4px;font:14px system-ui,"Yu Gothic UI",sans-serif}.noun-combo-popup[hidden]{display:none}.noun-combo-option{padding:7px 10px;border-radius:4px;cursor:pointer;overflow-wrap:anywhere}.noun-combo-option[aria-selected="true"]{background:#e0eee2}.noun-combo-option:hover{background:#edf4ed}';
document.head.append(style);
function attach(input,values){
 const id=input.id||`noun-combo-${++sequence}`;if(!input.id)input.id=id;
 const wrapper=document.createElement('div');wrapper.className='noun-combo';input.before(wrapper);wrapper.append(input);
 const button=document.createElement('button');button.type='button';button.tabIndex=-1;button.textContent='▾';button.setAttribute('aria-label',`${input.getAttribute('aria-label')||'名詞'}の一覧を開く`);wrapper.append(button);
 const popup=document.createElement('div');popup.id=id+'-listbox';popup.className='noun-combo-popup';popup.role='listbox';popup.hidden=true;popup.setAttribute('aria-label',`${input.getAttribute('aria-label')||'名詞'}の候補一覧`);document.body.append(popup);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','none');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',popup.id);input.setAttribute('autocomplete','off');input.removeAttribute('list');
 let active=-1,options=null;
 function close(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');if(opened===control)opened=null;}
 function position(){
  if(popup.hidden)return;const rect=wrapper.getBoundingClientRect(),height=window.innerHeight,width=Math.min(Math.max(rect.width,180),window.innerWidth-16),below=height-rect.bottom-8,above=rect.top-8,up=below<160&&above>below,space=Math.max(32,Math.min(280,up?above:below));
  popup.style.width=width+'px';popup.style.maxHeight=space+'px';popup.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';popup.style.top=(up?Math.max(8,rect.top-Math.min(popup.scrollHeight,space)-4):rect.bottom+4)+'px';
 }
 function activate(index){active=index;options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===index)));if(index>=0){input.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
 function choose(index){if(input.disabled||index<0)return;input.value=values[index];close();input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
 function open(direction=1){
  if(input.disabled)return;if(opened&&opened!==control)opened.close();
  if(!options){options=values.map((value,i)=>{const option=document.createElement('div');option.className='noun-combo-option';option.role='option';option.id=id+'-option-'+i;option.textContent=value;option.onpointerdown=event=>{event.preventDefault();choose(i);};popup.append(option);return option;});}
  popup.hidden=false;opened=control;input.setAttribute('aria-expanded','true');position();const match=values.indexOf(input.value);activate(match>=0?match:direction<0?values.length-1:0);
 }
 const onKey=event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const step=event.key==='ArrowDown'?1:-1;if(popup.hidden)open(step);else activate(Math.max(0,Math.min(values.length-1,active+step)));}
  else if(event.key==='Enter'&&!popup.hidden&&active>=0){event.preventDefault();choose(active);}
  else if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();close();}
  else if(event.key==='Tab')close();
 };
 const onInput=()=>{if(!popup.hidden)activate(-1);};
 const outside=event=>{if(!wrapper.contains(event.target)&&!popup.contains(event.target))close();};
 const onBlur=()=>{if(!wrapper.contains(document.activeElement))close();};
 input.addEventListener('keydown',onKey);input.addEventListener('input',onInput);input.addEventListener('blur',onBlur);button.onpointerdown=event=>event.preventDefault();button.onclick=()=>{input.focus();if(popup.hidden)open();else close();};
 document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
 const control={close,setDisabled(value){input.disabled=value;button.disabled=value;if(value)close();},destroy(){close();popup.remove();document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);input.removeEventListener('keydown',onKey);input.removeEventListener('input',onInput);input.removeEventListener('blur',onBlur);}};
 return control;
}
window.NounCombo={attach};
})();
