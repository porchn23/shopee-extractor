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
    "วันที่บันทึก", "ชื่อสินค้า", "ราคา", "ยอดขาย",
    "ดาว", "จำนวนรีวิว", "ลิงก์สินค้า", "ลิงก์ Affiliate", "รูปภาพ (รูปแรก)",
    "ลิงก์รูปทั้งหมด", "รายละเอียดสินค้า", "รีวิวจากผู้ซื้อ (รวม)"
  ];

  // สร้างหัวตารางอัตโนมัติถ้ายังไม่มี (แถวแรกว่างอยู่)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  } else {
    // migrate ชีตเก่าที่มี 11 คอลัมน์ (ไม่มี "ลิงก์รูปทั้งหมด") ให้เป็น schema ใหม่ 자동으로
    try {
      const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headerRow[0] === "วันที่บันทึก" && headerRow.length !== HEADER.length) {
        sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
      }
    } catch (err) { /* อ่าน header ไม่ได้ก็ข้ามไป */ }
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
