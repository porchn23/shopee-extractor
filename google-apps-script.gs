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

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const HEADER = [
    "วันที่บันทึก", "แพลตฟอร์ม", "สถานะ", "ชื่อสินค้า", "ราคา", "ยอดขาย",
    "ดาว", "จำนวนรีวิว", "ลิงก์สินค้า", "ลิงก์ Affiliate", "รูปภาพ (รูปแรก)",
    "ลิงก์รูปทั้งหมด", "รายละเอียดสินค้า", "รีวิวจากผู้ซื้อ (รวม)"
  ];

  // สร้างหัวตารางถ้ายังไม่มี; ถ้าชีตเก่าขาดคอลัมน์ไหน ให้แทรกตามตำแหน่ง
  // (ใช้ insertColumn ข้อมูลแถวเก่าจะถูกดันไปขวาให้ตรงคอลัมน์เดิม ไม่เลื่อนหลุด)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  } else {
    try {
      const firstCell = String(sheet.getRange(1, 1).getValue());
      if (firstCell === "วันที่บันทึก") {
        // 1) rename คอลัมน์เก่าให้ตรง schema ใหม่ก่อน (ข้อมูลแถวเก่าไม่ขยับ)
        const renames = { "รูปภาพ": "รูปภาพ (รูปแรก)" };
        let hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
          .map(function (v) { return String(v); });
        for (let i = 0; i < hdr.length; i++) {
          const target = renames[hdr[i]];
          if (target && hdr.indexOf(target) === -1) {
            sheet.getRange(1, i + 1).setValue(target);
            hdr[i] = target;
          }
        }
        // 2) แทรกคอลัมน์ที่ขาดตามตำแหน่ง (insertColumn ดันข้อมูลเก่าไปขวาให้ตรงเอง)
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

  function getAllImages(item) {
    if (Array.isArray(item.images) && item.images.length) {
      return item.images.filter(function (u) { return !!u; }).slice(0, 30);
    }
    if (item.image) return [item.image];
    return [];
  }

  items.forEach(function (item) {
    const images = getAllImages(item);
    const firstImage = images.length ? String(images[0]).replace(/"/g, "") : "";
    const imageFormula = firstImage ? '=IMAGE("' + firstImage + '")' : "";
    const allImageLinks = images.join("\n");
    const reviewsJoined = (item.reviews && item.reviews.length)
      ? item.reviews.map(function (r, i) { return (i + 1) + ". " + r; }).join("\n\n")
      : "";
    sheet.appendRow([
      new Date(),
      item.platform || "",
      item.status || "N/A",
      item.title || "",
      item.price || "",
      item.sold || "",
      item.ratingStar || "",
      item.ratingCount || "",
      item.url || "",
      item.affiliateUrl || "",
      imageFormula,
      allImageLinks,
      item.description || "",
      reviewsJoined
    ]);
  });

  // ปรับความสูงแถวให้พอดีกับรูปที่เพิ่งเพิ่ม
  sheet.setRowHeightsForced(sheet.getLastRow() - items.length + 1, items.length, 80);

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", added: items.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
