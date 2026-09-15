/**
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ที่จะใช้เก็บข้อมูลสินค้า (สร้างชีตใหม่ก็ได้)
 * 2. เมนู Extensions > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดนี้ทับ
 * 4. กด Deploy > New deployment > เลือกประเภท "Web app"
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. กด Deploy แล้ว copy "Web app URL" ที่ได้ (จะขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 6. เอา URL นั้นไปวางในช่อง "Google Sheet URL" ของ extension (ครั้งเดียว)
 */

function doGet() {
  // เปิด URL นี้ในเบราว์เซอร์แล้วเห็นข้อความนี้ = Deploy ถูกต้องพร้อมรับข้อมูล
  return ContentService
    .createTextOutput("Shopee Extractor API is running. Send product data with POST.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  // Schema ปลายทาง (16 คอลัมน์ — ตรงกับ pipeline ทำคอนเทนต์ 1:1)
  const HEADER = [
    "วันที่บันทึก", "title", "platform", "price", "rating", "review_count",
    "product_url", "affiliate_url", "sales_count", "image_urls",
    "product_description", "product_specifications", "reviews",
    "script", "main_image", "status"
  ];

  // สร้างหัวตารางถ้ายังไม่มี; ชีตที่ใช้ schema ใหม่อยู่แล้วจะเติมคอลัมน์ที่ขาดให้
  // ชีต schema ไทยเดิม (คอลัมน์ที่ 2 ไม่ใช่ "title") โครงสร้างไม่ตรงกัน จะแทนที่ header ใหม่ทั้งแถว
  // (แถวเก่ายังอยู่แต่ใช้ schema เดิม — ควรย้าย/ลบทิ้งเอง)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  } else {
    try {
      const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function (v) { return String(v); });
      if (hdr[0] === "วันที่บันทึก") {
        if (hdr[1] === "title") {
          for (let guard = 0; guard < 20; guard++) {
            const cur = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
              .map(function (v) { return String(v); });
            let done = true;
            for (let i = 0; i < HEADER.length; i++) {
              if (i < cur.length && cur[i] === HEADER[i]) continue;
              if (i >= cur.length) {
                sheet.getRange(1, i + 1).setValue(HEADER[i]); // ต่อท้าย
              } else {
                sheet.insertColumnBefore(i + 1); // แทรกแล้วดันข้อมูลเก่าไปขวา
                sheet.getRange(1, i + 1).setValue(HEADER[i]);
              }
              done = false;
              break; // อ่าน header ใหม่ในรอบถัดไป
            }
            if (done) break;
          }
        } else {
          sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
        }
      }
    } catch (err) { /* อ่าน/แก้ header ไม่ได้ก็ข้ามไป */ }
  }

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "invalid JSON" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const items = Array.isArray(data) ? data : [data];

  // แปลงราคา ("฿27,690" / "27690.00" / 27690) → ตัวเลข
  function toNumberPrice(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? '' : n;
  }

  // แปลงยอดขาย ("ขายแล้ว 1.2พัน ชิ้น" → 1200, "708" → 708, ไม่รู้ → 0)
  function parseSalesCount(v, soldText) {
    if (typeof v === 'number' && !isNaN(v)) return Math.round(v);
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      const n = parseInt(v, 10);
      if (!isNaN(n)) return n;
    }
    const s = String(soldText || '').replace(/,/g, '');
    const m = s.match(/([\d.]+)\s*(พัน|หมื่น|แสน|ล้าน|[kKmM])?/);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    if (isNaN(num)) return 0;
    const mults = { 'พัน': 1e3, 'หมื่น': 1e4, 'แสน': 1e5, 'ล้าน': 1e6, 'k': 1e3, 'K': 1e3, 'm': 1e6, 'M': 1e6 };
    return Math.round(num * (mults[m[2]] || 1));
  }

  function imageUrlsText(item) {
    if (Array.isArray(item.image_urls)) return item.image_urls.filter(Boolean).slice(0, 30).join('\n');
    if (typeof item.image_urls === 'string') return item.image_urls;
    let imgs = [];
    if (Array.isArray(item.images) && item.images.length) imgs = item.images;
    else if (item.image) imgs = [item.image];
    return imgs.filter(function (u) { return !!u; }).slice(0, 30).join('\n');
  }

  // main_image = สูตร IMAGE รูปแรกไว้โชว์ในชีต (ถ้า extension ส่ง URL มาเองก็ใช้ค่านั้น)
  function mainImageFormula(item) {
    const direct = item.main_image || item.mainImage || '';
    let url = '';
    if (direct && /^https?:\/\//i.test(String(direct))) {
      url = String(direct).replace(/"/g, '');
    } else {
      let imgs = [];
      if (Array.isArray(item.images) && item.images.length) imgs = item.images;
      else if (item.image) imgs = [item.image];
      if (imgs.length) url = String(imgs[0]).replace(/"/g, '');
    }
    return url ? '=IMAGE("' + url + '")' : '';
  }

  function specJson(v) {
    const base = { category: '', stock: '', dimension: null, shipsFrom: '' };
    let o = null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v;
    else if (typeof v === 'string' && v) { try { o = JSON.parse(v); } catch (e) { o = null; } }
    if (o && typeof o === 'object') {
      for (const k in base) if (o[k] !== undefined) base[k] = o[k];
    }
    return JSON.stringify(base);
  }

  // รีวิว → JSON string [{user,date,variation,review,sellerResponse}]
  // (extension ส่งมาเป็นข้อความล้วน จะห่อให้เป็น object ให้ — user/date/variation ว่างไว้ก่อน)
  function reviewsJson(v) {
    let arr = Array.isArray(v) ? v : (v ? [v] : []);
    arr = arr.map(function (r) {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        return {
          user: r.user || '', date: r.date || '', variation: r.variation || '',
          review: r.review || r.text || '', sellerResponse: (r.sellerResponse == null ? null : r.sellerResponse)
        };
      }
      return { user: '', date: '', variation: '', review: String(r), sellerResponse: null };
    });
    return JSON.stringify(arr);
  }

  items.forEach(function (item) {
    const rating = (item.rating !== undefined && item.rating !== null && item.rating !== '')
      ? item.rating : (item.ratingStar || '');
    const reviewCount = (item.review_count !== undefined && item.review_count !== null && item.review_count !== '')
      ? item.review_count : (item.ratingCount || '');
    const scriptVal = (item.script !== undefined && item.script !== null)
      ? (typeof item.script === 'object' ? JSON.stringify(item.script) : String(item.script)) : '';
    sheet.appendRow([
      new Date(),
      item.title || '',
      item.platform || '',
      toNumberPrice(item.price),
      rating,
      reviewCount,
      item.product_url || item.url || '',
      item.affiliate_url || item.affiliateUrl || '',
      parseSalesCount(item.sales_count, item.sold),
      imageUrlsText(item),
      (item.product_description !== undefined && item.product_description !== null)
        ? item.product_description : (item.description || ''),
      specJson(item.product_specifications || item.specifications),
      reviewsJson(item.reviews),
      scriptVal,
      mainImageFormula(item),
      item.status || 'N/A'
    ]);
  });

  // ปรับความสูงแถวให้พอดีกับรูป main_image ที่โชว์
  sheet.setRowHeightsForced(sheet.getLastRow() - items.length + 1, items.length, 80);

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", added: items.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
