const extractBtn = document.getElementById('extractBtn');
const copyBtn = document.getElementById('copyBtn');
const sendSheetBtn = document.getElementById('sendSheetBtn');
const resultDiv = document.getElementById('result');
const statusDiv = document.getElementById('status');
const sheetUrlInput = document.getElementById('sheetUrlInput');
const saveSheetUrlBtn = document.getElementById('saveSheetUrlBtn');

let lastData = null;

// ---------- โหลด/บันทึก URL ของ Google Sheet (Apps Script Web App) ----------
chrome.storage.local.get(['sheetUrl'], (res) => {
  if (res.sheetUrl) sheetUrlInput.value = res.sheetUrl;
});

saveSheetUrlBtn.addEventListener('click', () => {
  const url = sheetUrlInput.value.trim();
  chrome.storage.local.set({ sheetUrl: url }, () => {
    statusDiv.textContent = url ? '✅ บันทึก URL แล้ว' : 'ล้าง URL แล้ว';
  });
});

document.getElementById('openSetupBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ---------- Picker: เลือกส่วนรีวิว / รายละเอียดสินค้า ----------
const pickReviewBtn = document.getElementById('pickReviewBtn');
const pickDescBtn = document.getElementById('pickDescBtn');
const pickerStatus = document.getElementById('pickerStatus');

async function renderPickerStatus() {
  const stored = await chrome.storage.local.get(['reviewSelector', 'descriptionSelector', 'pickerResult']);
  const parts = [];
  parts.push(stored.reviewSelector ? '✅ ตั้งค่าส่วนรีวิวแล้ว' : '⬜ ยังไม่ได้ตั้งค่าส่วนรีวิว');
  parts.push(stored.descriptionSelector ? '✅ ตั้งค่าส่วนรายละเอียดแล้ว' : '⬜ ยังไม่ได้ตั้งค่าส่วนรายละเอียด');
  pickerStatus.innerHTML = parts.join('<br/>');

  if (stored.pickerResult && !stored.pickerResult.cancelled) {
    const r = stored.pickerResult;
    if (r.mode === 'reviews') {
      pickerStatus.innerHTML += `<br/>ล่าสุด: พบ ${r.count} รายการที่คล้ายกัน`;
    } else if (r.mode === 'description') {
      pickerStatus.innerHTML += `<br/>ล่าสุด: "${r.preview}..."`;
    }
    // เคลียร์ผลลัพธ์หลังแสดงแล้วครั้งเดียว
    chrome.storage.local.remove('pickerResult');
  }
}
renderPickerStatus();

async function activatePicker(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('shopee')) {
    pickerStatus.textContent = 'กรุณาเปิดหน้าเว็บ Shopee ก่อนใช้งาน';
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['picker.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (m) => startPicker(m),
    args: [mode],
  });
  // เปิดเป็น Side Panel จึงค้างอยู่ได้ขณะคลิกเลือกในหน้าเว็บ (ไม่ปิดตัวเองเหมือน popup)
  // ผลลัพธ์จะถูกบันทึกไว้ใน storage แล้วแสดงสถานะทันทีโดยไม่ต้องเปิดใหม่
}

pickReviewBtn.addEventListener('click', () => activatePicker('reviews'));
pickDescBtn.addEventListener('click', () => activatePicker('description'));

async function sendToSheet(payload) {
  const { sheetUrl } = await chrome.storage.local.get(['sheetUrl']);
  if (!sheetUrl) {
    statusDiv.textContent = '⚠️ กรุณาใส่ Google Sheet URL ในช่องตั้งค่าด้านบนก่อน';
    return false;
  }
  try {
    // ใช้ mode no-cors เพราะ Apps Script Web App ไม่ส่ง CORS header กลับมา
    // (ส่งข้อมูลได้ปกติ แต่โค้ดฝั่งนี้จะอ่าน response กลับไม่ได้ จึงต้องเดาว่าสำเร็จจากการไม่ error)
    await fetch(sheetUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch (err) {
    statusDiv.textContent = '❌ ส่งไม่สำเร็จ: ' + err.message;
    return false;
  }
}

function formatForClipboard(data) {
  const images = (Array.isArray(data.images) && data.images.length) ? data.images : (data.image ? [data.image] : []);
  const lines = [
    `ชื่อสินค้า: ${data.title || '-'}`,
    `แพลตฟอร์ม: ${data.platform || '-'}`,
    `สถานะ: ${data.status || 'N/A'}`,
    `ราคา: ${data.price || '-'}`,
    `ยอดขาย: ${data.sold || '-'}`,
    `ดาว: ${data.ratingStar || '-'}`,
    `จำนวนรีวิว: ${data.ratingCount || '-'}`,
    `ลิงก์สินค้า: ${data.url}`,
    `ลิงก์ Affiliate: ${data.affiliateUrl || '(ยังไม่ได้วาง)'}`,
    `รูปภาพ (${images.length} รูป): ${images.length ? images.join(' | ') : '-'}`,
    `รายละเอียดสินค้า: ${data.description || '-'}`,
  ];
  if (data.reviews && data.reviews.length) {
    lines.push('');
    lines.push(`รีวิวจากผู้ซื้อ (${data.reviews.length} รายการ):`);
    data.reviews.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  return lines.join('\n');
}

function renderResult(data) {
  const descPreview = data.description ? data.description.slice(0, 150) + (data.description.length > 150 ? '...' : '') : '-';
  const imgCount = (Array.isArray(data.images) && data.images.length) ? data.images.length : (data.image ? 1 : 0);
  resultDiv.innerHTML = `
    <div class="row"><span class="label">ชื่อ:</span> ${data.title || '-'}</div>
    <div class="row"><span class="label">แพลตฟอร์ม:</span> ${data.platform || '-'}</div>
    <div class="row"><span class="label">สถานะ:</span> ${data.status || 'N/A'}</div>
    <div class="row"><span class="label">ราคา:</span> ${data.price || '-'}</div>
    <div class="row"><span class="label">ยอดขาย:</span> ${data.sold || '-'}</div>
    <div class="row"><span class="label">ดาว:</span> ${data.ratingStar || '-'}</div>
    <div class="row"><span class="label">จำนวนรีวิว:</span> ${data.ratingCount || '-'}</div>
    <div class="row"><span class="label">รูปภาพ:</span> ${imgCount} รูป</div>
    <div class="row"><span class="label">รายละเอียด:</span> ${descPreview}</div>
    <div class="row"><span class="label">รีวิวที่ดึงได้:</span> ${data.reviews ? data.reviews.length : 0} รายการ</div>
  `;
  statusDiv.textContent = `อ่านจาก: ${data.source === 'json-ld' ? 'ข้อมูลโครงสร้างหน้า (แม่นยำ)' : 'ข้อความในหน้า (โปรดตรวจสอบอีกครั้ง)'}`;
}

extractBtn.addEventListener('click', async () => {
  statusDiv.textContent = 'กำลังอ่าน...';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url || !tab.url.includes('shopee')) {
    resultDiv.textContent = 'กรุณาเปิดหน้าเว็บ Shopee ก่อนใช้งาน';
    statusDiv.textContent = '';
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['extractor.js'],
    });

    lastData = result;
    // ใช้ค่าสถานะเริ่มต้นที่ตั้งไว้ในหน้าตั้งค่า (ถ้ามี)
    try {
      const { defaultStatus } = await chrome.storage.local.get(['defaultStatus']);
      if (defaultStatus) lastData.status = defaultStatus;
    } catch (e) { /* ใช้ค่าจากหน้าสินค้าแทน */ }
    renderResult(result);
    copyBtn.disabled = false;
    sendSheetBtn.disabled = false;
  } catch (err) {
    resultDiv.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    statusDiv.textContent = '';
  }
});

copyBtn.addEventListener('click', async () => {
  if (!lastData) return;
  lastData.affiliateUrl = document.getElementById('affiliateUrlInput').value.trim();
  const text = formatForClipboard(lastData);
  await navigator.clipboard.writeText(text);
  statusDiv.textContent = '✅ คัดลอกแล้ว วางในแชท Claude ได้เลย';
});

sendSheetBtn.addEventListener('click', async () => {
  if (!lastData) return;
  lastData.affiliateUrl = document.getElementById('affiliateUrlInput').value.trim();
  statusDiv.textContent = 'กำลังส่งไปที่ Google Sheet...';
  const ok = await sendToSheet(lastData);
  if (ok) statusDiv.textContent = '✅ ส่งไปที่ Google Sheet แล้ว (เปิดชีตดูเพื่อยืนยัน)';
});
