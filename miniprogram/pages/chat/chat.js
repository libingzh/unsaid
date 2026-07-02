const app = getApp();
Page({
  data: {
    me: '我', ta: 'TA', speaker: 'me', draft: '', ph: '发消息…',
    msgs: [],        // 渲染用(含 tip)
    store: [],       // 真实消息 {who,text,ts}
    menu: false, msgCount: 0, scrollTo: ''
  },
  onLoad(){
    const me = app.globalData.me, ta = app.globalData.ta;
    const store = app.loadMsgs();
    const msgs = store.map(m => ({ type:'msg', who:m.who, text:m.text }));
    this.setData({ me, ta, store, msgs, msgCount: store.length, ph: '以 '+me+' 的身份发…' });
    if(store.length === 0){
      this.pushTip('单人测试:用下面的"'+me+' / '+ta+'"切换身份,把两个人的话都打出来。','sys');
      this.pushTip('攒够几轮后,点右上 ⋯ →"回忆模式",用真实对话和"过去的 '+ta+'"聊。','sys');
    }
    this.scrollBottom();
  },
  onShow(){
    // 从回忆页返回时刷新计数
    const store = app.loadMsgs();
    this.setData({ store, msgCount: store.length });
  },
  onInput(e){ this.setData({ draft: e.detail.value }); },
  setMe(){ this.setData({ speaker:'me', ph:'以 '+this.data.me+' 的身份发…' }); },
  setTa(){ this.setData({ speaker:'ta', ph:'以 '+this.data.ta+' 的身份发…' }); },

  send(){
    const t = (this.data.draft||'').trim();
    if(!t) return;
    const m = { who: this.data.speaker, text: t, ts: Date.now() };
    const store = this.data.store.concat([m]);
    const msgs = this.data.msgs.concat([{ type:'msg', who:m.who, text:m.text }]);
    app.saveMsgs(store);
    this.setData({ store, msgs, draft:'', msgCount: store.length });
    this.scrollBottom();
    // 联网时:此处调用云端推送(见部署说明)
  },
  pushTip(text, kind){
    const msgs = this.data.msgs.concat([{ type:'tip', text, kind }]);
    this.setData({ msgs });
  },
  scrollBottom(){
    this.setData({ scrollTo: '' });
    setTimeout(()=> this.setData({ scrollTo: 'bottom-anchor' }), 50);
  },

  openMenu(){ this.setData({ menu:true, msgCount:this.data.store.length }); },
  closeMenu(){ this.setData({ menu:false }); },
  showStats(){
    const s = this.data.store;
    const me = s.filter(m=>m.who==='me').length;
    const ta = s.filter(m=>m.who==='ta').length;
    this.setData({ menu:false });
    wx.showModal({
      title: '这段时间的记录',
      content: '共 '+s.length+' 条\n'+this.data.me+' '+me+' 条 / '+this.data.ta+' '+ta+' 条\n\n'+this.data.ta+' 的话越多,回忆模式越像 TA(需 ≥3 条)。',
      showCancel: false
    });
  },
  clearAll(){
    wx.showModal({ title:'清空记录', content:'确定清空所有记录?不可恢复。', success:(r)=>{
      if(r.confirm){ app.saveMsgs([]); this.setData({ store:[], msgs:[], msgCount:0, menu:false }); }
    }});
  },
  exportText(){
    const s = this.data.store;
    if(!s.length){ wx.showToast({ title:'还没有消息', icon:'none' }); return; }
    const txt = s.map(m => (m.who==='me'?this.data.me:this.data.ta)+': '+m.text).join('\n');
    wx.setClipboardData({ data: txt, success:()=>{ this.setData({ menu:false }); wx.showToast({ title:'已复制到剪贴板' }); }});
  },
  enterMem(){
    const taCount = this.data.store.filter(m=>m.who==='ta').length;
    if(taCount < 3){ this.setData({ menu:false }); wx.showToast({ title: this.data.ta+' 的消息还太少('+taCount+' 条)', icon:'none' }); return; }
    this.setData({ menu:false });
    wx.navigateTo({ url: '/pages/memory/memory' });
  },
  goHome(){ wx.navigateBack(); }
});
