const app = getApp();
const R = require('../../utils/retrieval.js');
Page({
  data: { ta:'TA', draft:'', msgs:[], scrollTo:'' },
  onLoad(){
    const ta = app.globalData.ta;
    const store = app.loadMsgs();
    const built = R.buildPairs(store);
    this.pairs = built.pairs;
    this.taLines = built.taLines;
    this.fbi = 0;
    this.fallbacks = ['我一时不知道该怎么接…但我在听着呢。','这个我们好像没聊过,可你说,我都想听。','嗯…(想了想)再多说点?'];
    const opener = this.pairs[0] ? this.pairs[0].a : (this.taLines[0] || '在的');
    this.setData({ ta });
    this.pushTip('已载入你们 '+this.pairs.length+' 组对话。说点什么,我会用 '+ta+' 说过的话回你。','sys');
    setTimeout(()=> this.pushBubble(opener,'ta'), 300);
  },
  onInput(e){ this.setData({ draft: e.detail.value }); },
  pushTip(text, kind){ this.setData({ msgs: this.data.msgs.concat([{type:'tip',text,kind}]) }); this.scrollBottom(); },
  pushBubble(text, who){ this.setData({ msgs: this.data.msgs.concat([{type:'msg',who,text}]) }); this.scrollBottom(); },
  scrollBottom(){ this.setData({ scrollTo:'' }); setTimeout(()=> this.setData({ scrollTo:'mbottom' }), 50); },
  send(){
    const t = (this.data.draft||'').trim();
    if(!t) return;
    this.pushBubble(t, 'me');
    this.setData({ draft:'' });
    if(/不想活|自杀|活不下去|结束自己|轻生/.test(t)){
      setTimeout(()=>{ this.pushTip('⚠ 安全提醒(非检索结果)','sys'); this.pushBubble('我有点担心你。我只是基于记录的程序,接不住这些——但你值得被真正接住。如果难受,请联系信任的人或拨打心理援助热线。','ta'); }, 400);
      return;
    }
    const r = R.retrieve(t, this.pairs, this.taLines);
    setTimeout(()=>{
      if(r.pair && r.score >= 0.12){
        const pct = Math.round(r.score*100);
        if(r.pair.q) this.pushTip('🔎 你曾说过"'+r.pair.q+'"(相近 '+pct+'%)→ '+this.data.ta+' 当时这样回','hit');
        else this.pushTip('📎 引用 '+this.data.ta+' 说过的话(相近 '+pct+'%)','hit');
        this.pushBubble(r.pair.a, 'ta');
      } else {
        this.pushBubble(this.fallbacks[this.fbi % this.fallbacks.length], 'ta'); this.fbi++;
        this.pushTip('⚠ 记录里没有相近的话 —— 纯检索的局限','miss');
      }
    }, 500);
  },
  goBack(){ wx.navigateBack(); }
});
