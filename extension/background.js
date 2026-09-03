// Klik ikon ekstensi → buka tab tool (atau fokus kalau sudah ada).
chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('app.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
});