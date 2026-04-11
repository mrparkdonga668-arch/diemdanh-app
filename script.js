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
// 2. CẤU HÌNH HỆ THỐNG (THỐNG NHẤT BIẾN)
// ==========================================
const video = document.getElementById('video');
const qrReaderDiv = document.getElementById('reader');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');

const SCHOOL_LAT = 20.897007783267334;
const SCHOOL_LON = 106.67248743684335;
const SECRET_KEY = "HàngHải2026@Secure"; // ĐÃ THỐNG NHẤT VỚI ADMIN.HTML
const FB_URL = "https://hanghai-6f86f-default-rtdb.asia-southeast1.firebasedatabase.app"; 
const currentClass = "Lop_K62_01"; // ĐÃ KHAI BÁO BIẾN LỚP CỐ ĐỊNH
const TIME_WINDOW = 15; 
let serverTimeOffset = 0;
let html5QrcodeScanner;

// Đồng bộ thời gian API
async function syncTime() {
    try {
        const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh');
        const data = await res.json();
        serverTimeOffset = new Date(data.datetime).getTime() - Date.now();
    } catch(e) { console.error("Time sync failed"); }
}
syncTime();

function getNow() { return Date.now() + serverTimeOffset; }

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
                if (dist > 0.5) { // Nới lỏng lên 500m để dễ test
                    statusDiv.innerHTML = `❌ Bạn đang ở quá xa trường (${Math.round(dist*1000)}m).`;
                    btnStart.style.display = "inline-block";
                } else {
                    statusDiv.innerHTML = "✅ Vị trí hợp lệ. Đang kiểm tra lớp học...";
                    startQRScanner();
                }
            },
            (error) => {
                statusDiv.innerHTML = "❌ Lỗi: Bạn cần bật GPS và cho phép truy cập vị trí.";
                btnStart.style.display = "inline-block";
            },
            { enableHighAccuracy: true }
        );
    }
}

// ==========================================
// 4. LOGIC QR CODE (KIỂM TRA SESSION)
// ==========================================
async function startQRScanner() {
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "⏳ Đang kết nối máy chủ lớp học...";
    
    try {
        const response = await fetch(`${FB_URL}/active_sessions/${currentClass}.json`);
        const session = await response.json();

        if (!session) {
            statusDiv.innerHTML = "<b style='color:red;'>⚠️ LỚP CHƯA MỞ!</b><br>Vui lòng đợi thầy/cô bấm nút 'Mở lớp'.";
            btnStart.style.display = "inline-block";
            btnStart.innerText = "Thử lại";
            return;
        }

        statusDiv.innerHTML = "✅ Lớp đã mở. Đang bật camera quét QR...";
        qrReaderDiv.style.display = "block";
        
        html5QrcodeScanner = new Html5Qrcode("reader");
        html5QrcodeScanner.start(
            { facingMode: "environment" },
            { fps: 15, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                handleQRScanned(decodedText, session);
            }
        ).catch(err => {
            statusDiv.innerHTML = "❌ Không thể mở camera sau.";
        });

    } catch (error) {
        statusDiv.innerHTML = "⚠️ Lỗi kết nối: " + error.message;
        btnStart.style.display = "inline-block";
    }
}

function handleQRScanned(scannedToken, session) {
    const now = getNow();
    const timeBlock = Math.floor(now / 15000);
    
    // Tính toán token đối chứng
    const validToken = CryptoJS.HmacSHA256(`${currentClass}_${timeBlock}_${session.salt}`, SECRET_KEY).toString();
    const prevToken = CryptoJS.HmacSHA256(`${currentClass}_${timeBlock - 1}_${session.salt}`, SECRET_KEY).toString();

    if (scannedToken === validToken || scannedToken === prevToken) {
        html5QrcodeScanner.stop().then(() => {
            qrReaderDiv.style.display = "none";
            statusDiv.innerHTML = "✅ QR hợp lệ! Đang bật camera trước quét mặt...";
            startFaceCamera(session); // Truyền session vào để dùng sau này
        });
    } else {
        statusDiv.innerHTML = "❌ Mã QR không đúng hoặc đã hết hạn!";
    }
}

// ==========================================
// 5. NHẬN DIỆN MẶT (GIỮ NGUYÊN LOGIC AI CỦA BẠN)
// ==========================================
async function startFaceCamera(session) {
    statusDiv.style.display = "none"; 
    const camContainer = document.getElementById('camera-container');
    const camInstruction = document.getElementById('cam-instruction');
    camContainer.style.display = "block";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
    } catch (err) { 
        alert("Không thể mở camera trước!"); 
        return; 
    }

    // Thiết lập tùy chọn cho AI
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    
    // Lấy dữ liệu khuôn mặt đã đăng ký từ localStorage để so sánh
    const savedFaceData = JSON.parse(CryptoJS.AES.decrypt(localStorage.getItem("KHH_FACE_DATA"), DEVICE_TOKEN).toString(CryptoJS.enc.Utf8));
    const labeledDescriptors = [new faceapi.LabeledFaceDescriptors(STUDENT_ID, savedFaceData.map(d => new Float32Array(d)))];
    const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.4);

    let livenessState = "CHECK_FACE"; // Trạng thái: Kiểm tra mặt -> Kiểm tra quay đầu

    const scanInterval = setInterval(async () => {
        const detection = await faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks().withFaceDescriptor();
        
        if (detection) {
            if (livenessState === "CHECK_FACE") {
                const match = faceMatcher.findBestMatch(detection.descriptor);
                if (match.label !== "unknown") {
                    livenessState = "CHECK_TURN";
                    camInstruction.innerHTML = "✅ Khớp mặt! <br>HÃY QUAY ĐẦU SANG TRÁI HOẶC PHẢI";
                    camInstruction.style.color = "#ffeb3b";
                } else {
                    camInstruction.innerHTML = "Mặt không khớp với dữ liệu đăng ký!";
                }
            } 
            else if (livenessState === "CHECK_TURN") {
                // Kiểm tra hành động quay đầu (Liveness)
                const landmarks = detection.landmarks.positions;
                const noseTip = landmarks[30].x;
                const leftEdge = landmarks[0].x;
                const rightEdge = landmarks[16].x;
                const turnRatio = (noseTip - leftEdge) / (rightEdge - noseTip);

                if (turnRatio > 1.8 || turnRatio < 0.6) { // Đã quay đầu
                    clearInterval(scanInterval);
                    camInstruction.innerHTML = "🎉 XÁC THỰC THÀNH CÔNG!";
                    // CHỈ KHI ĐẾN ĐÂY MỚI GỌI HÀM GỬI DỮ LIỆU
                    completeAttendance(detection.descriptor, session);
                }
            }
        } else {
            camInstruction.innerHTML = "Hãy đưa mặt vào khung xanh";
        }
    }, 500);
}

// ==========================================
// 6. HOÀN TẤT & GỬI DỮ LIỆU
// ==========================================
function completeAttendance(descriptor, session) {
    // Tắt camera ngay lập tức
    video.pause();
    if(video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    document.getElementById('camera-container').style.display = "none";
    
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "⏳ Đang gửi kết quả điểm danh...";

    const timestamp = getNow();
    
    // Tạo signature khớp với yêu cầu của Rules
    const signature = CryptoJS.HmacSHA256(STUDENT_ID + timestamp, session.salt).toString();

    const payload = {
        student_id: STUDENT_ID,
        timestamp: timestamp,
        signature: signature,
        device: navigator.userAgent
    };

    // Gửi lên Firebase
    fetch(`${FB_URL}/checkins.json`, {
        method: "POST",
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) throw new Error("Firebase từ chối ghi dữ liệu");
        return response.json();
    })
    .then(() => {
        // CHỈ KHI LÊN FIREBASE THÀNH CÔNG MỚI HIỆN TRẠM TIẾP SỨC
        statusDiv.innerHTML = `<div style="color: green; font-size: 20px;">🎉 ĐIỂM DANH THÀNH CÔNG!</div>`;
        activateRelayMode(session);
    })
    .catch((err) => {
        console.error(err);
        statusDiv.innerHTML = `<div style="color: red;">❌ LỖI GỬI DỮ LIỆU: ${err.message}</div>`;
        btnStart.style.display = "inline-block";
        btnStart.innerText = "Thử lại";
    });
}

// CHẾ ĐỘ TIẾP SỨC
function activateRelayMode(session) {
    const relayDiv = document.createElement('div');
    relayDiv.innerHTML = `
        <div style="padding:20px; text-align:center; background:white; border-radius:15px; margin-top:20px; border:2px solid #28a745;">
            <h3>🌟 TRẠM TIẾP SỨC</h3>
            <p>Bạn đã điểm danh xong. Hãy cho bạn khác quét mã dưới đây để hỗ trợ.</p>
            <div id="relayQr" style="display:flex; justify-content:center;"></div>
            <p>Hết hạn sau: <span id="relayTimer">300</span>s</p>
        </div>`;
    document.body.appendChild(relayDiv);
    
    let relayQr = new QRCode(document.getElementById("relayQr"), { width: 200, height: 200 });
    let relayStart = getNow();

    setInterval(() => {
        const now = getNow();
        const elapsed = now - relayStart;
        if (elapsed > 300000) { relayDiv.innerHTML = "Hết thời gian hỗ trợ."; return; }

        document.getElementById('relayTimer').innerText = Math.floor((300000 - elapsed)/1000);
        let timeBlock = Math.floor(now / 15000);
        let token = CryptoJS.HmacSHA256(`${currentClass}_${timeBlock}_${session.salt}`, SECRET_KEY).toString();
        relayQr.makeCode(token);
    }, 1000);
}

// TẢI AI FACE
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    statusDiv.innerHTML = "Hệ thống sẵn sàng! Bấm nút để bắt đầu.";
    btnStart.style.display = "inline-block";
});

// PWA Logic (Giữ nguyên của bạn...)
window.addEventListener('load', showPwaInstructions);