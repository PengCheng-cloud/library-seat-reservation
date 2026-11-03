const ASSISTANT_RESULT_STORAGE_KEY = "library.latestAssistantResult";

function setLatestAssistantResult(result) {
  if (!result) {
    wx.removeStorageSync(ASSISTANT_RESULT_STORAGE_KEY);
    return;
  }

  wx.setStorageSync(ASSISTANT_RESULT_STORAGE_KEY, {
    savedAt: Date.now(),
    result
  });
}

function getLatestAssistantResult() {
  const payload = wx.getStorageSync(ASSISTANT_RESULT_STORAGE_KEY);
  return payload && payload.result ? payload.result : null;
}

function clearLatestAssistantResult() {
  wx.removeStorageSync(ASSISTANT_RESULT_STORAGE_KEY);
}

module.exports = {
  setLatestAssistantResult,
  getLatestAssistantResult,
  clearLatestAssistantResult
};
