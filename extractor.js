// extractor.js
// รันในหน้า Shopee ที่เปิดอยู่ (ผ่าน chrome.scripting.executeScript)
// อ่านข้อมูลจาก DOM/JSON-LD ของหน้าปัจจุบันเท่านั้น ไม่มีการยิง request ไปที่อื่น

async function extractShopeeProduct() {
  const result = {
    title: null,
    price: null,
    priceOriginal: null,
    sold: null,
    ratingStar: null,
    ratingCount: null,
    url: window.location.href,
    images: [],
    description: null,
    reviews: [],
    source: null, // "json-ld" หรือ "dom"
  };

  // ---------- วิธีที่ 1: อ่านจาก JSON-LD (เสถียรกว่า เพราะเป็น schema.org มาตรฐาน) ----------
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
        if (item['@type'] === 'Product' || (item['@graph'] && item['@graph'].some(g => g['@type'] === 'Product'))) {
          const product = item['@type'] === 'Product' ? item : item['@graph'].find(g => g['@type'] === 'Product');
          if (product) {
            result.title = product.name || result.title;
            if (product.offers) {
              const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              result.price = offer.price || offer.lowPrice || result.price;
            }
            if (product.aggregateRating) {
              result.ratingStar = product.aggregateRating.ratingValue || null;
              result.ratingCount = product.aggregateRating.reviewCount || product.aggregateRating.ratingCount || null;
            }
            if (product.image) {
              result.images = Array.isArray(product.image) ? product.image : [product.image];
            }
            result.source = 'json-ld';
          }
        }
      }
    }
  } catch (e) {
    console.warn('JSON-LD parse error', e);
  }

  // ---------- วิธีที่ 2: fallback อ่านจาก DOM ตรงๆ ----------
  // หมายเหตุ: Shopee เปลี่ยนชื่อ class บ่อยและมักสุ่ม จึงพยายามหาแบบกว้างๆ
  // จากข้อความ/รูปแบบเนื้อหา แทนการอิง class name ตายตัว
  if (!result.title) {
    const h1 = document.querySelector('h1');
    if (h1) result.title = h1.textContent.trim();
  }

  if (!result.price) {
    // มองหาข้อความที่ขึ้นต้นด้วย ฿ หรือ THB ในหน้า
    const bodyText = document.body.innerText;
    const priceMatch = bodyText.match(/[฿]\s?[\d,]+/);
    if (priceMatch) result.price = priceMatch[0];
  }

  if (!result.sold) {
    const bodyText = document.body.innerText;
    // รูปแบบทั่วไปของ Shopee: "ขายแล้ว 1.2พัน ชิ้น" หรือ "1,234 sold"
    const soldMatch = bodyText.match(/ขายแล้ว[^\n]{0,20}/) || bodyText.match(/[\d,.]+[kKพันหมื่น]*\s*sold/i);
    if (soldMatch) result.sold = soldMatch[0].trim();
  }

  if (!result.ratingStar) {
    const bodyText = document.body.innerText;
    const starMatch = bodyText.match(/(\d\.\d)\s*(?=\/5|ดาว|star)/i);
    if (starMatch) result.ratingStar = starMatch[1];
  }

  if (!result.ratingCount) {
    const bodyText = document.body.innerText;
    const reviewMatch = bodyText.match(/(\d[\d,.]*)\s*(?:รีวิว|reviews?|การให้คะแนน)/i);
    if (reviewMatch) result.ratingCount = reviewMatch[1];
  }

  if (!result.source) result.source = 'dom-fallback';

  // ---------- รูปภาพทั้งหมด: รวม JSON-LD + og:image + สแกน CDN Shopee ในหน้า ----------
  // Shopee ใส่รูป carousel ไว้หลายที่ (JSON-LD มักมีแค่รูปแรก) จึงกวาดจาก <img> และ <script> เพิ่ม
  // ปัญหารูปซ้ำหลายขนาด (เช่น file_abc กับ file_abc_tn) แก้ด้วย normalize เป็น key เดียวกันแล้วเก็บแค่รูปใหญ่สุด
  (function collectAllImages() {
    const bestByKey = new Map(); // key (file id ที่ normalize แล้ว) -> clean URL รูปใหญ่สุด

    function normalizeKey(cleanUrl) {
      try {
        const path = cleanUrl.split('?')[0].split('#')[0];
        const segs = path.split('/');
        let last = segs[segs.length - 1] || path;
        // ตัด @resize_w82_nl / @resize_w450_nl.webp ออกก่อน (Shopee ใช้ suffix นี้บอกรูปย่อ)
        last = last.split('@')[0];
        // ตัดนามสกุลออกก่อน (.jpg/.png/.webp) เพราะบาง URL มี บาง URL ไม่มี แต่คือรูปเดียวกัน
        last = last.replace(/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i, '');
        // ตัด suffix ขนาดของ Shopee ออก: _tn, _small, _medium, _large, _thumb, _mini, _80x80 ฯลฯ
        last = last.replace(/(_tn|_tny|_small|_medium|_large|_thumb|_thumbs|_mini|_list|_card|_item)(?=$|[^a-z0-9])/i, '');
        last = last.replace(/([_-]\d{2,4}x\d{2,4})(?=$|[^0-9])/i, '');
        last = last.replace(/([_-](tn|small|medium|large|s|m|l|xl|xs|xxs))$/i, '');
        if (last.length < 4 || /^(image|img|photo|default|placeholder|product)$/i.test(last)) return cleanUrl.toLowerCase();
        return last.toLowerCase();
      } catch (e) {
        return cleanUrl.toLowerCase();
      }
    }

    function sizePenalty(cleanUrl) {
      // ยิ่งเยอะ = ยิ่งเล็ก/ยิ่งไม่ดี — เอาไว้เลือก URL ที่ใหญ่สุดในกลุ่ม key เดียวกัน
      const u = cleanUrl.toLowerCase();
      // รูปย่อ @resize_w82 / w164 เล็กจนใช้ไม่ได้ ต้องโทษหนักสุด
      const wm = u.match(/@resize_w(\d+)/);
      if (wm) {
        const w = parseInt(wm[1], 10);
        if (w <= 100) return 100; // w82 thumbnail จิ๋ว
        if (w <= 200) return 70;  // w164
        if (w <= 500) return 40;  // w450
        return 20;                // w900 ขึ้นไปพอใช้ได้
      }
      if (u.indexOf('@') !== -1) return 50; // @ แบบอื่นถือว่าเป็นรูปแปลงขนาด
      if (/_tn(\b|_|\.)/.test(u)) return 20;
      if (/_(thumb|thumbs|mini|small|list|card)(?=$|[^a-z])/.test(u)) return 15;
      if (/_\d{2,4}x\d{2,4}/.test(u)) return 10;
      if (/_(s|m|l|xl|xs|xxs)(?=$|[^a-z])/.test(u)) return 8;
      return 0;
    }

    function toLargeUrl(cleanUrl) {
      // สร้าง URL รูปใหญ่จากรูปเล็ก: หน้าเว็บมักมีแต่ไฟล์ย่อ (_tn / @resize_w82_nl.webp)
      // แต่ไฟล์ต้นฉบับ (ตัด suffix ออก) มีอยู่จริงบน CDN เสมอ → สังเคราะห์เอาเลย
      // เช่น .../file_th-abc_tn → .../file_th-abc
      //      .../th-xxx@resize_w82_nl.webp → .../th-xxx (รูปใหญ่ต้นฉบับ)
      try {
        let base = cleanUrl.split('@')[0]; // ตัด @resize_... ทิ้งทั้งก้อนก่อน
        const m = base.match(/^(.*)(\.(jpg|jpeg|png|webp|gif))$/i);
        const ext = m ? m[2] : '';
        base = m ? m[1] : base;
        base = base.replace(/(_tn|_tny|_small|_medium|_large|_thumb|_thumbs|_mini|_list|_card|_item)(?=$|[^a-z0-9])/i, '');
        base = base.replace(/([_-]\d{2,4}x\d{2,4})(?=$|[^0-9])/i, '');
        base = base.replace(/([_-](tn|small|medium|large|s|m|l|xl|xs|xxs))$/i, '');
        return base + ext;
      } catch (e) {
        return cleanUrl;
      }
    }

    const pushImg = (u) => {
      if (!u || typeof u !== 'string') return;
      // กัน URL ชนกัน (regex กวาดจาก <script> อาจได้ url1https://url2 ติดกันมา) → แยกก่อน
      const chunks = u.trim().split(/(?=https?:\/\/)/);
      if (chunks.length > 1) { chunks.forEach(pushImg); return; }
      u = u.trim().split(' ')[0].replace(/[\\,;)'"]+$/, '');
      if (!/^https?:\/\//i.test(u)) return;
      if (!/susercontent|shopee/i.test(u)) return;
      // ตัด query resize (?w=...&...) ออก — URL สะอาด = รูปต้นฉบับใหญ่สุด
      const clean = u.split('?')[0].split('#')[0];
      if (clean.length < 20) return;
      if (/avatar|icon|logo|badge|voucher|banner|star|rating|placeholder|spinner|loading/i.test(clean)) return;
      // แปลงเป็นรูปใหญ่ก่อนเก็บ (กันกรณีในหน้าเว็บมีแต่ _tn)
      const large = toLargeUrl(clean);
      const key = normalizeKey(large);
      const prev = bestByKey.get(key);
      if (!prev) {
        bestByKey.set(key, large);
      } else if (sizePenalty(clean) < sizePenalty(prev)) {
        // เจอเวอร์ชันใหญ่กว่าในภายหลัง (เช่น เจอ _tn ก่อน แล้วเจอต้นฉบับทีหลัง) → อัปเกรดแทนที่ แต่คงลำดับเดิม
        bestByKey.set(key, large);
      }
    };

    // รูปจาก JSON-LD ที่ได้มาก่อนหน้า เอาเข้าระบบ dedupe เดียวกัน (ไม่ใส่ตรงๆ)
    (result.images || []).slice().forEach(pushImg);
    result.images = [];

    // og:image (มีเกือบทุกหน้า)
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) pushImg(ogImage.content);

    // กวาดจาก <img> — เฉพาะกรอบแกลเลอรีสินค้าหลักเท่านั้น (กันรูปสินค้าแนะนำ/ร้านอื่นด้านล่างปน)
    // วิธีหา: รูปสินค้าหลักคือ <img> ที่แสดงใหญ่สุดในช่วงบนของหน้า แล้วเก็บทุก <img> ในกรอบเดียวกัน
    try {
      const isProductImg = (u) => u && /susercontent|shopee/i.test(u)
        && !/avatar|icon|logo|badge|voucher|banner|star|rating|placeholder|spinner|loading/i.test(u);
      const allImgs = Array.from(document.querySelectorAll('img'));
      const vh = window.innerHeight || 800;
      let mainImg = null, mainArea = 0;
      for (const img of allImgs) {
        const src = img.currentSrc || img.src;
        if (!isProductImg(src)) continue;
        let r = null;
        try { r = img.getBoundingClientRect(); } catch (e) { /* วัดไม่ได้ก็ข้าม */ }
        if (!r || r.width < 100 || r.height < 100) continue;
        if (r.top > vh * 2.5) continue; // ต่ำกว่านี้คือโซนสินค้าแนะนำแล้ว ไม่เอา
        const area = r.width * r.height;
        if (area > mainArea) { mainArea = area; mainImg = img; }
      }
      // ไต่ขึ้นหาขอบแกลเลอรี: ancestor ที่มีรูปสินค้าเยอะสุด (รูปหลัก + thumbnails + รูปตัวเลือก) แต่ไม่เกิน 40 รูป
      let galleryRoot = null, bestCount = 0;
      if (mainImg) {
        let node = mainImg.parentElement, depth = 0;
        while (node && node.querySelectorAll && depth < 8) {
          const count = Array.from(node.querySelectorAll('img'))
            .filter(im => isProductImg(im.currentSrc || im.src)).length;
          if (count > 40) break; // กว้างเกินไปแล้ว (หลุดไปทั้งหน้า) หยุด
          if (count >= 2 && count >= bestCount) { bestCount = count; galleryRoot = node; }
          node = node.parentElement; depth++;
        }
      }
      // ถ้าหาแกลเลอรีไม่เจอ → ไม่กวาด <img> ทั้งหน้า (กันรูปอื่นปน) ใช้แค่ JSON-LD/og:image/script แทน
      const scoped = galleryRoot ? Array.from(galleryRoot.querySelectorAll('img')) : [];
      for (const img of scoped) {
        const candidates = [
          img.currentSrc, img.src,
          img.getAttribute('data-src'), img.getAttribute('data-original'),
          img.getAttribute('data-lazy'), img.getAttribute('data-url'),
        ];
        for (const c of candidates) if (c) pushImg(c);
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
        if (srcset) {
          srcset.split(',').forEach(part => pushImg(part.trim().split(' ')[0]));
        }
      }
    } catch (e) {
      console.warn('img scan error', e);
    }

    // กวาดจาก <script> — เฉพาะข้อมูลสินค้าตัวที่เปิดอยู่เท่านั้น (เทียบ itemId จาก URL)
    // ไม่กวาดทั้งหน้าแล้ว เพราะจะดูดรูปสินค้าแนะนำ/สินค้าร้านอื่นปนมาด้วย
    // แหล่งรูปหลักคือ __PRELOADED_STATE__ ที่มีรูปรายการ + รูปตัวเลือกของสินค้าตัวนี้
    try {
      const urlM = (window.location.href || '').match(/-i\.(\d+)\.(\d+)/);
      const itemId = urlM ? urlM[2] : null;
      const scripts = document.querySelectorAll('script:not([type="application/ld+json"])');
      const urlRe = /https?:\/\/[^\s"'\\<>]+\.(?:jpg|jpeg|png|webp)/gi;
      const suserRe = /https?:\/\/[^\s"'\\<>]*susercontent[^\s"'\\<>]*/gi;
      const scanSlice = (slice) => {
        if (!slice) return;
        let m;
        urlRe.lastIndex = 0;
        while ((m = urlRe.exec(slice)) !== null) {
          pushImg(m[0]);
          if (bestByKey.size >= 50) break;
        }
        suserRe.lastIndex = 0;
        while ((m = suserRe.exec(slice)) !== null) {
          // ตัดอักขระต่อท้ายที่ติดมาจาก JSON (เช่น \ , ; ) ออก
          pushImg(m[0].replace(/[\\,;)]+$/, ''));
          if (bestByKey.size >= 50) break;
        }
      };
      // เตรียมข้อความ (unescape https:\/\/... และ //...) ของสคริปต์ที่มีรูป Shopee
      const texts = [];
      let totalLen = 0;
      for (const s of scripts) {
        let txt = s.textContent || '';
        if (!txt || txt.length < 100 || txt.length > 5000000) continue;
        if (txt.indexOf('susercontent') === -1 && txt.indexOf('shopee') === -1) continue;
        txt = txt.replace(/\\\//g, '/');
        txt = txt.replace(/([^:\/])\/\/(?=[^\"'\\\s<>]*susercontent|[^\"'\\\s<>]*shopee)/gi, '$1https://');
        texts.push(txt);
        totalLen += txt.length;
        if (totalLen > 6000000) break;
      }
      if (itemId) {
        // หน้าต่างรอบ itemId ทุกจุด (±8000 ตัวอักษร) — ตรงนี้มีรูปรายการ + รูปตัวเลือกของสินค้าตัวนี้
        for (const txt of texts) {
          let idx = -1, found = 0;
          while ((idx = txt.indexOf(itemId, idx + 1)) !== -1 && found < 5) {
            const before = txt[idx - 1] || '', after = txt[idx + itemId.length] || '';
            if (/\d/.test(before) || /\d/.test(after)) continue; // เป็นส่วนหนึ่งของเลขที่ยาวกว่า → ข้าม
            found++;
            scanSlice(txt.slice(Math.max(0, idx - 8000), idx + 8000));
            if (bestByKey.size >= 50) break;
          }
          if (bestByKey.size >= 50) break;
        }
      }
      // ถ้ายังได้น้อย (เช่น URL ไม่มี itemId) → เอา array "images" ชุดแรกของ state ก้อนใหญ่สุด (มักคือ carousel สินค้าหลัก)
      if (bestByKey.size < 2) {
        let biggest = '';
        for (const txt of texts) if (txt.length > biggest.length) biggest = txt;
        if (biggest) {
          const re = /\"images\"\s*:\s*\[/g;
          let m, taken = 0;
          while ((m = re.exec(biggest)) !== null && taken < 2) {
            taken++;
            let depth = 0, end = m.index;
            for (let i = m.index; i < biggest.length && i < m.index + 8000; i++) {
              if (biggest[i] === '[') depth++;
              else if (biggest[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
            }
            scanSlice(biggest.slice(m.index, end + 1));
          }
        }
      }
    } catch (e) {
      console.warn('script scan error', e);
    }

    // เก็บสูงสุด 30 รูป (รูปหลัก + รูปตัวเลือกสินค้า) รูปแรก = รูปหลักคงเดิมเพื่อ backward compatible
    // ค่าใน Map คือ URL รูปใหญ่สุดของแต่ละ key แล้ว (ลำดับ = ลำดับที่เจอครั้งแรก = ลำดับ carousel)
    result.images = Array.from(bestByKey.values()).slice(0, 30);
  })();
  result.image = result.images && result.images.length > 0 ? result.images[0] : null;

  // ---------- รายละเอียดสินค้า + รีวิว: ใช้ selector ที่ผู้ใช้เลือกไว้ล่วงหน้า (ถ้ามี) ----------
  try {
    const stored = await chrome.storage.local.get(['reviewSelector', 'descriptionSelector']);

    if (stored.descriptionSelector) {
      const el = document.querySelector(stored.descriptionSelector);
      if (el) result.description = el.innerText.trim();
    }
    if (!result.description) {
      // fallback: og:description (สั้นกว่าของจริงมาก แต่ดีกว่าไม่มีเลย)
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc && ogDesc.content) result.description = ogDesc.content;
    }

    if (stored.reviewSelector) {
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(stored.reviewSelector));
      } catch (e) {
        matches = [];
      }
      const texts = matches.map(el => el.innerText.trim()).filter(t => t.length > 5);
      result.reviews = Array.from(new Set(texts));
    }
  } catch (e) {
    console.warn('reading stored selectors failed', e);
  }

  return result;
}

// ต้อง return ค่าผ่าน chrome.scripting.executeScript (เป็น async function ได้)
extractShopeeProduct();
