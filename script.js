const video = document.getElementById('video');
const qrReaderDiv = document.getElementById('reader');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');

// --- CẤU HÌNH ---
const SCHOOL_LAT = 20.897007783267334;
const SCHOOL_LON = 106.67248743684335;
const SECRET_KEY = "Kh0aH4ngHai_DiemDanh_2026"; // Khớp với Secret của Thầy
const TIME_WINDOW = 15;
let html5QrcodeScanner;

// TẢI MÔ HÌNH AI FACE
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    statusDiv.innerHTML = "Sẵn sàng! Bấm nút để kiểm tra vị trí.";
    statusDiv.style.color = "blue";
    btnStart.style.display = "inline-block";
});

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Bán kính trái đất (km)
    var dLat = (lat2-lat1) * (Math.PI/180);
    var dLon = (lon2-lon1) * (Math.PI/180); 
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; // Trả về số km
}

// BƯỚC 1: KHI SINH VIÊN BẤM NÚT "BẮT ĐẦU"
function startProcess() {
    statusDiv.innerHTML = "Đang kiểm tra vị trí GPS...";
    btnStart.style.display = "none";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let dist = getDistanceFromLatLonInKm(position.coords.latitude, position.coords.longitude, SCHOOL_LAT, SCHOOL_LON);
                
                // Cho phép sai số 0.2 km (200 mét)
                if (dist > 0.2) {
                    statusDiv.innerHTML = `❌ Lỗi: Bạn đang cách trường ${Math.round(dist*1000)} mét. Vui lòng vào lớp!`;
                    btnStart.style.display = "inline-block";
                } else {
                    statusDiv.innerHTML = "✅ GPS Hợp lệ. Hãy đưa camera quét mã trên bảng!";
                    statusDiv.style.color = "#ff9800";
                    startQRScanner(); // Chuyển sang Bước 2
                }
            },
            (error) => {
                statusDiv.innerHTML = "❌ Lỗi: Bạn chưa cấp quyền vị trí cho trình duyệt!";
            },
            { enableHighAccuracy: true } // Yêu cầu GPS độ chính xác cao
        );
    } else {
        statusDiv.innerHTML = "Điện thoại của bạn không hỗ trợ GPS.";
    }
}

// Hàm kiểm tra mã QR có hợp lệ với thời gian hiện tại không
function isValidToken(scannedToken) {
    let currentBlock = Math.floor(Date.now() / 1000 / TIME_WINDOW);
    let tokenNow = "DD_" + CryptoJS.SHA256(SECRET_KEY + currentBlock).toString().substring(0, 15);
    let tokenPrev = "DD_" + CryptoJS.SHA256(SECRET_KEY + (currentBlock - 1)).toString().substring(0, 15);
    
    return scannedToken === tokenNow || scannedToken === tokenPrev;
}

// BƯỚC 2: QUÉT MÃ QR ĐỘNG (Dùng camera sau)
function startQRScanner() {
    qrReaderDiv.style.display = "block";
    
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" }, // Camera sau
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            if (isValidToken(decodedText)) {
                // Tắt máy quét QR
                html5QrcodeScanner.stop().then(() => {
                    qrReaderDiv.style.display = "none";
                    statusDiv.innerHTML = "✅ Mã QR hợp lệ. Đang bật camera trước...";
                    startFaceCamera(); // Chuyển sang Bước 3
                });
            } else {
                statusDiv.innerHTML = "❌ Mã QR đã hết hạn! Hãy quét lại mã mới trên bảng.";
                statusDiv.style.color = "red";
            }
        },
        (errorMessage) => { /* Bỏ qua lỗi khung hình trống */ }
    ).catch((err) => { statusDiv.innerHTML = "❌ Không thể mở Camera sau."; });
}

// BƯỚC 3: QUÉT MẶT XÁC THỰC VÀ KIỂM TRA LIVENESS (NGƯỜI THẬT)
async function startFaceCamera() {
    video.style.display = "block";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
    } catch (err) { statusDiv.innerHTML = "❌ Lỗi: Không thể mở Camera trước."; return; }

    statusDiv.innerHTML = "Đang tải ảnh hồ sơ để đối chiếu...";
    try {
        const refImage = await faceapi.fetchImage('./anh_goc.jpg');
        const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 });
        const refDetection = await faceapi.detectSingleFace(refImage, detectorOptions).withFaceLandmarks().withFaceDescriptor();
        
        if (!refDetection) {
            statusDiv.innerHTML = "❌ Lỗi: Ảnh gốc không đủ tiêu chuẩn."; return;
        }
        const faceMatcher = new faceapi.FaceMatcher(refDetection.descriptor, 0.5);
        
        // --- QUẢN LÝ TRẠNG THÁI AI ---
        let livenessState = "CHECK_FACE"; // Các trạng thái: CHECK_FACE -> CHECK_TURN -> SUCCESS
        let finalDistance = 0;

        statusDiv.innerHTML = "Đang quét khuôn mặt. Vui lòng nhìn thẳng...";
        statusDiv.style.color = "black";
        
        // Thay đổi từ 1000ms xuống 300ms để bắt chuyển động quay đầu mượt mà hơn
        const scanInterval = setInterval(async () => {
            const detection = await faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks().withFaceDescriptor();
            
            if (detection) {
                // Lấy tọa độ các điểm trên khuôn mặt
                const landmarks = detection.landmarks.positions;
                const leftEdge = landmarks[0].x;   // Viền mặt trái
                const rightEdge = landmarks[16].x; // Viền mặt phải
                const noseTip = landmarks[30].x;   // Chóp mũi
                
                // Tính toán tỷ lệ quay đầu
                const leftDist = noseTip - leftEdge;
                const rightDist = rightEdge - noseTip;
                const turnRatio = leftDist / rightDist;

                // TRẠNG THÁI 1: Xác nhận đúng người
                if (livenessState === "CHECK_FACE") {
                    const match = faceMatcher.findBestMatch(detection.descriptor);
                    if (match.label !== "unknown") {
                        finalDistance = match.distance.toFixed(2);
                        livenessState = "CHECK_TURN"; // Chuyển sang yêu cầu quay đầu
                        statusDiv.innerHTML = "✅ Khớp khuôn mặt! Vui lòng quay đầu từ từ sang một bên (Trái hoặc Phải)...";
                        statusDiv.style.color = "blue";
                    } else {
                        statusDiv.innerHTML = "❌ Khuôn mặt không khớp với hồ sơ!";
                        statusDiv.style.color = "red";
                    }
                } 
                // TRẠNG THÁI 2: Yêu cầu chứng minh là người thật (Liveness)
                else if (livenessState === "CHECK_TURN") {
                    // Nếu tỷ lệ < 0.6 (Quay phải) HOẶC tỷ lệ > 1.6 (Quay trái)
                    if (turnRatio > 1.6 || turnRatio < 0.6) {
                        livenessState = "SUCCESS";
                        
                        clearInterval(scanInterval); // Dừng vòng lặp AI
                        video.pause();
                        video.srcObject.getTracks().forEach(track => track.stop()); // Tắt hẳn camera
                        
                        statusDiv.style.color = "green";
                        statusDiv.innerHTML = `✅ ĐIỂM DANH THÀNH CÔNG!<br> <small>(Sai số: ${finalDistance} - Đã xác thực thực thể sống)</small>`;
                    }
                }
            } else {
                if(livenessState === "CHECK_FACE") {
                    statusDiv.innerHTML = "Chưa tìm thấy khuôn mặt trong khung hình...";
                }
            }
        }, 300); // Quét 0.3 giây / lần
    } catch (error) {
        statusDiv.innerHTML = "❌ Lỗi hệ thống: " + error.message;
    }
}