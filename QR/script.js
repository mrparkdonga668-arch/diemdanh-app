// ====================================================================
// 🔴 KHU VỰC ĐIỀN THÔNG TIN CỦA BẠN (ĐÁNH DẤU CHO BẠN DỄ SỬA)
// ====================================================================

// 1. Thay đổi địa chỉ trang web điểm danh tại đây:
const LINK_DIEM_DANH = "https://hanghai.dpdns.org"; 

// 2. Thay đổi địa chỉ Video hướng dẫn (YouTube / Google Drive) tại đây:
const LINK_VIDEO_HUONG_DANH = "https://www.youtube.com/watch?v=LINK_VIDEO_CUA_BAN_O_DAY"; 

// ====================================================================
// ====================================================================


// Code tự động tạo mã QR khi trang web vừa tải xong
window.onload = function() {
    
    // Tạo mã QR cho trang Điểm Danh
    const qrAttendanceElement = document.getElementById("qr-attendance");
    qrAttendanceElement.innerHTML = ""; // Xóa placeholder
    new QRCode(qrAttendanceElement, {
        text: LINK_DIEM_DANH,
        width: 220,
        height: 220,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H // Chuẩn H giúp QR dễ quét kể cả khi in bị mờ
    });

    // Tạo mã QR cho Video Hướng dẫn
    const qrGuideElement = document.getElementById("qr-guide");
    qrGuideElement.innerHTML = ""; // Xóa placeholder
    new QRCode(qrGuideElement, {
        text: LINK_VIDEO_HUONG_DANH,
        width: 220,
        height: 220,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });

};