// 未尽小程序 · 全局
App({
  globalData: {
    me: '我',
    ta: 'TA'
  },
  // 读取本地保存的消息
  loadMsgs() {
    try { return wx.getStorageSync('weijin_msgs') || []; } catch (e) { return []; }
  },
  saveMsgs(msgs) {
    try { wx.setStorageSync('weijin_msgs', msgs); } catch (e) {}
  }
});
