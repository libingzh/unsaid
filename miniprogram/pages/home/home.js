const app = getApp();
Page({
  data: { me: '', ta: '' },
  onMe(e){ this.setData({ me: e.detail.value }); },
  onTa(e){ this.setData({ ta: e.detail.value }); },
  start(){
    app.globalData.me = (this.data.me || '我').trim();
    app.globalData.ta = (this.data.ta || 'TA').trim();
    wx.navigateTo({ url: '/pages/chat/chat' });
  }
});
