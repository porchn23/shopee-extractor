// list-extractor.js
// รันบนหน้าค้นหา/หน้ารายการสินค้าของ Shopee (search result, flash sale, category page)
// อ่านสินค้าหลายตัวพร้อมกันจากหน้าที่เปิดอยู่เท่านั้น ไม่มีการยิง request ไปที่อื่น

function extractShopeeProductList() {
  const products = [];

  // ---------- วิธีที่ 1: ItemList จาก JSON-LD (ถ้ามี) ----------
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (e) {
        continue;
      }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
          for (const el of item.itemListElement) {
            const p = el.item || el;
            if (p) {
              products.push({
                title: p.name || null,
                price: p.offers ? (p.offers.price || p.offers.lowPrice) : null,
                url: p.url || null,
                sold: null,
                source: 'json-ld-itemlist',
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('JSON-LD list parse error', e);
  }

  if (products.length > 0) {
    return { products, source: 'json-ld-itemlist' };
  }

  // ---------- วิธีที่ 2: fallback อ่านจาก DOM การ์ดสินค้า ----------
  // Shopee ใช้ URL รูปแบบ .../ชื่อสินค้า-i.SHOPID.ITEMID เป็นมาตรฐาน
  // จึงหา <a> ที่ href ตรงรูปแบบนี้เป็นตัวยึดแต่ละการ์ด แทนการอิงชื่อ class ที่สุ่มบ่อย
  const anchors = Array.from(document.querySelectorAll('a[href*="-i."]'));
  const seen = new Set();

  for (const a of anchors) {
    const href = a.href;
    if (seen.has(href)) continue;
    seen.add(href);

    const cardText = a.innerText || '';
    if (!cardText.trim()) continue;

    // แยกราคาจากข้อความในการ์ด
    const priceMatch = cardText.match(/[฿]\s?[\d,]+/);
    // แยกยอดขายจากข้อความในการ์ด (เช่น "ขายแล้ว 1.2พัน ชิ้น")
    const soldMatch = cardText.match(/ขายแล้ว[^\n]{0,20}/);

    // ชื่อสินค้ามักเป็นบรรทัดข้อความที่ยาวที่สุดในการ์ด
    const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines.sort((x, y) => y.length - x.length)[0] || null;

    // ดึงรูปภาพจากการ์ด (Shopee มักใช้ <img> ตัวแรกในการ์ดเป็นรูปสินค้า)
    const imgEl = a.querySelector('img');
    const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null;

    products.push({
      title,
      price: priceMatch ? priceMatch[0] : null,
      sold: soldMatch ? soldMatch[0] : null,
      url: href,
      image,
      source: 'dom-fallback',
    });
  }

  return { products, source: products.length ? 'dom-fallback' : 'none' };
}

extractShopeeProductList();
