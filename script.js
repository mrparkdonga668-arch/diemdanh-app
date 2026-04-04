// ==========================================
// 1. KIỂM TRA THIẾT BỊ ĐÃ ĐĂNG KÝ CHƯA
// ==========================================
const STUDENT_ID = localStorage.getItem("KHH_STUDENT_ID");
const DEVICE_TOKEN = localStorage.getItem("KHH_DEVICE_TOKEN");

if (!STUDENT_ID || !DEVICE_TOKEN) {
    document.body.innerHTML = `
        <div style="padding: 50px; text-align: center; font-family: Arial;">
            <h2 style="color:red;">⛔ THIẾT BỊ CHƯA ĐĂNG KÝ</h2>
            <p>Vui lòng đăng ký thông tin sinh trắc học trước khi điểm danh.</p>
            <a href="setup.html" style="color: blue; text-decoration: underline;">Đi tới trang đăng ký thiết bị</a>
        </div>`;
    throw new Error("Thiết bị chưa được xác thực");
}

// ==========================================
// 2. CẤU HÌNH HỆ THỐNG
// ==========================================
const video = document.getElementById('video');
const qrReaderDiv = document.getElementById('reader');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');

const SCHOOL_LAT = 20.897007783267334;
const SCHOOL_LON = 106.67248743684335;
const SECRET_KEY = "Kh0aH4ngHai_DiemDanh_2026"; 
const TIME_WINDOW = 15; // Giây
const FIREBASE_URL = "https://hanghai-6f86f-default-rtdb.asia-southeast1.firebasedatabase.app/checkins.json";

let html5QrcodeScanner;

// TẢI MÔ HÌNH AI FACE KHI TRANG LOAD
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    statusDiv.innerHTML = "Hệ thống sẵn sàng! Hãy bấm nút bắt đầu.";
    statusDiv.style.color = "blue";
    btnStart.style.display = "inline-block";
});

// ==========================================
// 3. LOGIC GPS (KIỂM TRA VỊ TRÍ)
// ==========================================
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = (lat2-lat1) * (Math.PI/180);
    var dLon = (lon2-lon1) * (Math.PI/180); 
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}

function startProcess() {
    statusDiv.innerHTML = "📍 Đang xác vị trí GPS...";
    btnStart.style.display = "none";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let dist = getDistanceFromLatLonInKm(position.coords.latitude, position.coords.longitude, SCHOOL_LAT, SCHOOL_LON);
                if (dist > 0.2) { // 200 mét
                    statusDiv.innerHTML = `❌ Bạn đang ở quá xa trường (${Math.round(dist*1000)}m).`;
                    btnStart.style.display = "inline-block";
                } else {
                    statusDiv.innerHTML = "✅ Vị trí hợp lệ. Đang bật máy quét mã QR...";
                    startQRScanner();
                }
            },
            (error) => {
                statusDiv.innerHTML = "❌ Lỗi: Bạn cần cho phép truy cập vị trí (GPS).";
                btnStart.style.display = "inline-block";
            },
            { enableHighAccuracy: true }
        );
    }
}

// ==========================================
// 4. LOGIC QR CODE (XÁC THỰC THỜI GIAN THỰC)
// ==========================================
function isValidToken(scannedToken) {
    let currentBlock = Math.floor(Date.now() / 1000 / TIME_WINDOW);
    let tokenNow = "DD_" + CryptoJS.SHA256(SECRET_KEY + currentBlock).toString().substring(0, 15);
    let tokenPrev = "DD_" + CryptoJS.SHA256(SECRET_KEY + (currentBlock - 1)).toString().substring(0, 15);
    return scannedToken === tokenNow || scannedToken === tokenPrev;
}

function startQRScanner() {
    qrReaderDiv.style.display = "block";
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            if (isValidToken(decodedText)) {
                html5QrcodeScanner.stop().then(() => {
                    qrReaderDiv.style.display = "none";
                    statusDiv.innerHTML = "✅ QR hợp lệ. Đang quét khuôn mặt...";
                    startFaceCamera();
                });
            } else {
                statusDiv.innerHTML = "❌ Mã QR không đúng hoặc đã hết hạn!";
                statusDiv.style.color = "red";
            }
        },
        (err) => {}
    ).catch(() => { statusDiv.innerHTML = "❌ Không thể mở camera sau."; });
}

// ==========================================
// 5. LOGIC NHẬN DIỆN MẶT ĐA GÓC ĐỘ & LIVENESS
// ==========================================
async function startFaceCamera() {
    video.style.display = "block";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
    } catch (err) { statusDiv.innerHTML = "❌ Lỗi mở camera trước."; return; }

    try {
        // A. GIẢI MÃ DỮ LIỆU ĐA GÓC (TỪ SETUP)
        const encryptedFaceData = localStorage.getItem("KHH_FACE_DATA");
        const bytes = CryptoJS.AES.decrypt(encryptedFaceData, DEVICE_TOKEN);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        const savedVectors = JSON.parse(decryptedString); // Đây là mảng [[...],[...],[...]]

        // B. CHUẨN BỊ AI MATCHER VỚI NHIỀU MẪU THAM CHIẾU
        const labeledDescriptors = new faceapi.LabeledFaceDescriptors(
            STUDENT_ID, 
            savedVectors.map(v => new Float32Array(v))
        );
        const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5);
        const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 });

        let livenessState = "CHECK_FACE"; 
        let finalDistance = 0;

        const scanInterval = setInterval(async () => {
            const detection = await faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks().withFaceDescriptor();
            
            if (detection) {
                // C. TÍNH TOÁN HÀNH ĐỘNG QUAY ĐẦU (Liveness)
                const landmarks = detection.landmarks.positions;
                const noseTip = landmarks[30].x;
                const leftEdge = landmarks[0].x;
                const rightEdge = landmarks[16].x;
                const turnRatio = (noseTip - leftEdge) / (rightEdge - noseTip);

                // D. TRẠNG THÁI 1: SO KHỚP MẶT (AI tìm mẫu giống nhất trong 3 góc đã lưu)
                if (livenessState === "CHECK_FACE") {
                    const match = faceMatcher.findBestMatch(detection.descriptor);
                    if (match.label !== "unknown") {
                        finalDistance = match.distance.toFixed(2);
                        livenessState = "CHECK_TURN";
                        statusDiv.innerHTML = "✅ Khớp khuôn mặt! <br><b>Hãy QUAY ĐẦU sang trái hoặc phải...</b>";
                        statusDiv.style.color = "blue";
                    } else {
                        statusDiv.innerHTML = "❌ Không nhận diện được bạn. Hãy nhìn thẳng!";
                    }
                } 
                // E. TRẠNG THÁI 2: KIỂM TRA NGƯỜI THẬT
                else if (livenessState === "CHECK_TURN") {
                    if (turnRatio > 1.8 || turnRatio < 0.55) { // Đã quay đầu
                        livenessState = "SUCCESS";
                        clearInterval(scanInterval);
                        completeAttendance(finalDistance);
                    }
                }
            }
        }, 300);

    } catch (error) {
        statusDiv.innerHTML = "❌ Lỗi sinh trắc học: " + error.message;
    }
}

// ==========================================
// 6. HOÀN TẤT VÀ GỬI DỮ LIỆU (BẢO MẬT HMAC)
// ==========================================
function completeAttendance(distance) {
    video.pause();
    video.srcObject.getTracks().forEach(track => track.stop());
    
    statusDiv.innerHTML = "⏳ Đang ký xác nhận điểm danh...";
    
    const timestamp = new Date().toISOString();
    const fingerprint = CryptoJS.MD5(screen.width + screen.height + navigator.hardwareConcurrency).toString();
    
    // Tạo chữ ký bảo mật để Server biết dữ liệu này gửi từ máy đã đăng ký
    const dataToSign = STUDENT_ID + timestamp + "VERIFIED" + fingerprint;
    const signature = CryptoJS.HmacSHA256(dataToSign, DEVICE_TOKEN).toString();

    const payload = {
        student_id: STUDENT_ID,
        timestamp: timestamp,
        status: "VERIFIED",
        face_match_dist: distance,
        device_fingerprint: fingerprint,
        signature: signature
    };

    fetch(FIREBASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(() => {
        statusDiv.innerHTML = `
            <div style="color: green; font-size: 22px;">
                🎉 ĐIỂM DANH THÀNH CÔNG!<br>
                <small style="color: gray; font-size: 14px;">Mã SV: ${STUDENT_ID}</small>
            </div>`;
    })
    .catch(() => {
        statusDiv.innerHTML = "⚠️ Lỗi kết nối. Chụp màn hình này báo cáo GV!";
    });
}