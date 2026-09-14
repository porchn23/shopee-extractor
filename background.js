// background.js (service worker)
// ตั้งให้คลิกไอคอน extension แล้วเปิดเป็น Side Panel (แผงข้าง) แทน popup
// Side Panel ไม่ปิดตัวเองตอนผู้ใช้คลิกเลือกในหน้าเว็บ → ทำ picker ต่อเนื่องได้โดยไม่ต้องเปิดใหม่
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch (e) {
  /* Chrome เก่าที่ไม่มี sidePanel API ก็ใช้ popup เดิมต่อไป */
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } catch (e) { /* ข้าม */ }
});
