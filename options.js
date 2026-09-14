// options.js — หน้าตัวช่วยตั้งค่าการเชื่อมต่อ Google Sheet (ทำครั้งเดียว)
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const copyStatusEl = $('copyStatus');

function say(msg) {
  statusEl.textContent = msg;
}

async function init() {
  try {
    const s = await chrome.storage.local.get(['sheetUrl', 'defaultStatus']);
    if (s.sheetUrl) $('sheetUrlInput2').value = s.sheetUrl;
    $('defaultStatusInput').value = s.defaultStatus || 'N/A';
  } catch (e) { /* อ่านค่าเก่าไม่ได้ก็ใช้ค่าว่าง */ }
}
init();

$('openSheetBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://sheets.new' });
});

$('copyCodeBtn').addEventListener('click', async () => {
  try {
    const res = await fetch(chrome.runtime.getURL('google-apps-script.gs'));
    const code = await res.text();
    await navigator.clipboard.writeText(code);
    copyStatusEl.textContent = '✅ คัดลอกแล้ว เอาไปวางใน Apps Script ได้เลย';
  } catch (err) {
    copyStatusEl.textContent = '❌ คัดลอกไม่สำเร็จ: ' + err.message;
  }
});

$('saveBtn').addEventListener('click', async () => {
  const url = $('sheetUrlInput2').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec\/?$/.test(url)) {
    say('⚠️ URL ไม่ถูกต้อง ต้องเป็น https://script.google.com/macros/s/.../exec');
    return;
  }
  await chrome.storage.local.set({ sheetUrl: url });
  say(url ? '✅ บันทึก URL แล้ว กด "ส่งแถวทดสอบ" เพื่อยืนยันได้เลย' : 'ล้าง URL แล้ว');
});

$('saveDefaultsBtn').addEventListener('click', async () => {
  const v = $('defaultStatusInput').value.trim() || 'N/A';
  await chrome.storage.local.set({ defaultStatus: v });
  say('✅ บันทึกค่าเริ่มต้นแล้ว (สถานะสินค้าใหม่: ' + v + ')');
});

$('testBtn').addEventListener('click', async () => {
  const { sheetUrl } = await chrome.storage.local.get(['sheetUrl']);
  if (!sheetUrl) {
    say('⚠️ บันทึก URL ก่อน (ขั้นตอนที่ 3)');
    return;
  }
  say('กำลังส่งแถวทดสอบ...');
  try {
    await fetch(sheetUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        title: '(ทดสอบการเชื่อมต่อ - ลบแถวนี้ได้เลย)',
        platform: 'Shopee',
        status: 'N/A',
        url: '',
      }),
    });
    say('✅ ส่งแล้ว เปิด Sheet ดูแถว "(ทดสอบการเชื่อมต่อ...)" ถ้าเจอ = เชื่อมสำเร็จ (ลบแถวนั้นทิ้งได้เลย)');
  } catch (err) {
    say('❌ ส่งไม่สำเร็จ: ' + err.message + ' (URL ผิดหรือเน็ตมีปัญหา)');
  }
});
