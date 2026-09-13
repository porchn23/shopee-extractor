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
  // popup จะปิดตัวเองทันทีที่ผู้ใช้ไปคลิกในหน้าเว็บ (พฤติกรรมปกติของ Chrome)
  // ผลลัพธ์จะถูกบันทึกไว้ใน storage แล้วแสดงตอนเปิด popup ครั้งถัดไป
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

// ---------- หน้าค้นหา/รายการสินค้า (หลายตัวพร้อมกัน) ----------
const extractListBtn = document.getElementById('extractListBtn');
const copyListBtn = document.getElementById('copyListBtn');
const sendListSheetBtn = document.getElementById('sendListSheetBtn');
let lastList = [];

function renderList(products) {
  if (!products.length) {
    resultDiv.textContent = 'ไม่พบสินค้าในหน้านี้ ลองเลื่อนหน้าให้สินค้าโหลดครบก่อนกดใหม่ (Shopee โหลดสินค้าเพิ่มตอนเลื่อนลง)';
    return;
  }
  const rows = products.slice(0, 40).map((p, i) => `
    <div class="row" style="border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:4px;">
      <span class="label">${i + 1}. ${p.title || '(ไม่พบชื่อ)'}</span><br/>
      ราคา: ${p.price || '-'} | ยอดขาย: ${p.sold || '-'}
    </div>
  `).join('');
  resultDiv.innerHTML = rows;
}

function toCSV(products) {
  const header = 'ชื่อสินค้า,ราคา,ยอดขาย,ลิงก์สินค้า,ลิงก์ Affiliate (กรอกเพิ่มเอง),ลิงก์รูปทั้งหมด';
  const escape = (v) => `"${(v || '').toString().replace(/"/g, '""')}"`;
  const getImgs = (p) => (Array.isArray(p.images) && p.images.length) ? p.images.join('\n') : (p.image || '');
  const lines = products.map(p => [escape(p.title), escape(p.price), escape(p.sold), escape(p.url), '', escape(getImgs(p))].join(','));
  return [header, ...lines].join('\n');
}

extractListBtn.addEventListener('click', async () => {
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
      files: ['list-extractor.js'],
    });

    lastList = result.products || [];
    renderList(lastList);
    copyListBtn.disabled = lastList.length === 0;
    sendListSheetBtn.disabled = lastList.length === 0;
    statusDiv.textContent = `พบ ${lastList.length} สินค้า (อ่านจาก: ${result.source === 'json-ld-itemlist' ? 'ข้อมูลโครงสร้างหน้า (แม่นยำ)' : 'ข้อความในหน้า (โปรดตรวจสอบอีกครั้ง)'})`;
  } catch (err) {
    resultDiv.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    statusDiv.textContent = '';
  }
});

copyListBtn.addEventListener('click', async () => {
  if (!lastList.length) return;
  const csv = toCSV(lastList);
  await navigator.clipboard.writeText(csv);
  statusDiv.textContent = `✅ คัดลอก ${lastList.length} รายการเป็น CSV แล้ว วางในไฟล์ Excel หรือแชท Claude ได้เลย`;
});

sendListSheetBtn.addEventListener('click', async () => {
  if (!lastList.length) return;
  statusDiv.textContent = `กำลังส่ง ${lastList.length} รายการไปที่ Google Sheet...`;
  const ok = await sendToSheet(lastList);
  if (ok) statusDiv.textContent = `✅ ส่ง ${lastList.length} รายการไปที่ Google Sheet แล้ว`;
});
