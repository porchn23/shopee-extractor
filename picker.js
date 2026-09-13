// picker.js
// รันเมื่อผู้ใช้กดปุ่ม "เลือกส่วนรีวิว" หรือ "เลือกส่วนรายละเอียดสินค้า"
// ผู้ใช้คลิกเลือกองค์ประกอบในหน้าเว็บเอง (แม่นกว่าการเดา selector เอง)
// mode: "reviews" (หาแบบซ้ำหลายอัน) หรือ "description" (หาแค่อันเดียว)

function startPicker(mode) {
  let hoveredEl = null;
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; z-index: 999999;
    background: #ee4d2d; color: #fff; font-family: Arial, sans-serif;
    font-size: 13px; padding: 8px 14px; border-radius: 0 0 6px 0;
  `;
  overlay.textContent = mode === 'reviews'
    ? '🎯 คลิกที่ "ข้อความรีวิว" อันหนึ่ง (กด Esc เพื่อยกเลิก)'
    : '🎯 คลิกที่กล่อง "รายละเอียดสินค้า" (กด Esc เพื่อยกเลิก)';
  document.body.appendChild(overlay);

  function highlight(el) {
    if (hoveredEl) hoveredEl.style.outline = '';
    hoveredEl = el;
    if (hoveredEl) hoveredEl.style.outline = '2px solid #ee4d2d';
  }

  function findAnchor(el) {
    // ไต่ขึ้นไปหา element ที่มีข้อความยาวพอสมควร (กันเลือกแค่ span เล็กๆ ในการ์ด)
    let node = el;
    let depth = 0;
    while (node && node.innerText && node.innerText.trim().length < 40 && depth < 6) {
      if (!node.parentElement) break;
      node = node.parentElement;
      depth++;
    }
    return node;
  }

  function buildSelector(el) {
    if (!el.className || typeof el.className !== 'string' || !el.className.trim()) {
      return el.tagName.toLowerCase();
    }
    const classes = el.className.trim().split(/\s+/).map(c => CSS.escape(c)).join('.');
    return `${el.tagName.toLowerCase()}.${classes}`;
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (hoveredEl) hoveredEl.style.outline = '';
    overlay.remove();
  }

  function onMove(e) {
    highlight(findAnchor(e.target));
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      cleanup();
      chrome.storage.local.set({ pickerResult: { mode, cancelled: true } });
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const anchor = findAnchor(e.target);
    const selector = buildSelector(anchor);

    let matches = [];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch (err) {
      matches = [anchor];
    }

    if (mode === 'reviews') {
      const texts = matches
        .map(el => el.innerText.trim())
        .filter(t => t.length > 5);
      const uniqueTexts = Array.from(new Set(texts));
      chrome.storage.local.set({
        reviewSelector: selector,
        pickerResult: { mode: 'reviews', count: uniqueTexts.length, preview: uniqueTexts.slice(0, 3), cancelled: false },
      });
    } else {
      chrome.storage.local.set({
        descriptionSelector: selector,
        pickerResult: { mode: 'description', preview: anchor.innerText.trim().slice(0, 200), cancelled: false },
      });
    }

    cleanup();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}
