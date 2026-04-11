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
let serverTimeOffset = 0;

// Đồng bộ thời gian API
async function syncTime() {
    const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh');
    const data = await res.json();
    serverTimeOffset = new Date(data.datetime).getTime() - Date.now();
}
syncTime();

function getNow() { return Date.now() + serverTimeOffset; }

// Kiểm tra GPS và QR
async function validateAndCheckin(scannedToken, session) {
    const now = getNow();
    let timeBlock = Math.floor(now / 15000);
    
    // Kiểm tra token quét được có khớp với token hệ thống không
    let validToken = CryptoJS.HmacSHA256(`${currentClass}_${timeBlock}_${session.salt}`, SECRET_KEY).toString();
    
    if (scannedToken === validToken) {
        // Thực hiện FaceID...
        // Nếu FaceID thành công -> Gọi hàm completeAttendance
        completeAttendance(session);
    }
}

function completeAttendance(session) {
    const studentId = localStorage.getItem("KHH_STUDENT_ID");
    const timestamp = getNow();
    
    // Tạo chữ ký bảo mật gửi lên Firebase (Rules sẽ kiểm tra cái này)
    const signature = CryptoJS.HmacSHA256(studentId + timestamp, session.salt).toString();

    const data = {
        student_id: studentId,
        timestamp: timestamp,
        signature: signature
    };

    fetch(`${FB_URL}/checkins.json`, { method: 'POST', body: JSON.stringify(data) })
    .then(() => {
        alert("Điểm danh thành công!");
        activateRelayMode(session);
    });
}

// Chế độ Tiếp sức (Relay)
function activateRelayMode(session) {
    document.body.innerHTML = `
        <div style="padding:20px; text-align:center;">
            <h3>🌟 BẠN LÀ TRẠM TIẾP SỨC</h3>
            <p>Hãy cho bạn khác quét mã này (Hiệu lực 5 phút)</p>
            <div id="relayQr"></div>
            <h2 id="relayTimer">300</h2>
        </div>
    `;
    
    let relayQr = new QRCode(document.getElementById("relayQr"), { width: 200, height: 200 });
    let relayStart = getNow();

    setInterval(() => {
        const now = getNow();
        const elapsed = now - relayStart;
        if (elapsed > 300000 || (now - session.startTime > 600000)) {
            document.body.innerHTML = "Hết quyền hỗ trợ.";
            return;
        }

        document.getElementById('relayTimer').innerText = Math.floor((300000 - elapsed)/1000) + "s";
        
        let timeBlock = Math.floor(now / 15000);
        let token = CryptoJS.HmacSHA256(`${currentClass}_${timeBlock}_${session.salt}`, SECRET_KEY).toString();
        relayQr.makeCode(token);
    }, 1000);
}

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

async function startQRScanner() {
    const cid = "Lop_K62_01"; // Sau này có thể lấy từ 1 menu chọn lớp
    
    // 1. Hiển thị trạng thái đang tải dữ liệu
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "⏳ Đang kết nối máy chủ lớp học...";
    statusDiv.style.color = "orange";
    qrReaderDiv.style.display = "none";

    try {
        // 2. Lấy thông tin phiên học (Session) từ Firebase
        const res = await fetch(`${FB_URL}/active_sessions/${cid}.json`);
        const session = await res.json();

        // 3. Kiểm tra nếu giảng viên chưa mở lớp
        if (!session) {
            statusDiv.innerHTML = "❌ Lớp học này chưa được mở!<br>Vui lòng đợi thầy/cô bấm 'Mở lớp'.";
            statusDiv.style.color = "red";
            btnStart.style.display = "inline-block"; // Hiện lại nút để thử lại
            return;
        }

        // 4. Kiểm tra thời gian phiên học (ví dụ quá 10 phút thì không cho quét nữa)
        const now = getNow();
        if (now - session.startTime > 600000) { // 600.000ms = 10 phút
            statusDiv.innerHTML = "❌ Phiên điểm danh này đã hết hạn (quá 10 phút).";
            statusDiv.style.color = "red";
            return;
        }

        // 5. Nếu mọi thứ ổn, bắt đầu bật Camera
        statusDiv.innerHTML = "✅ Đã kết nối! Đang khởi động camera quét QR...";
        statusDiv.style.color = "green";
        
        qrReaderDiv.style.display = "block";
        html5QrcodeScanner = new Html5Qrcode("reader");

        await html5QrcodeScanner.start(
            { facingMode: "environment" },
            { fps: 15, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                // Xử lý khi quét được mã
                handleQRScanned(decodedText, session, cid);
            },
            (err) => { /* Không log lỗi quét liên tục để tránh lag */ }
        );

    } catch (error) {
        console.error(error);
        statusDiv.innerHTML = "⚠️ Lỗi kết nối mạng. Hãy kiểm tra 4G/Wifi của bạn.";
        statusDiv.style.color = "red";
        btnStart.style.display = "inline-block";
    }
}

// Hàm tách riêng để xử lý logic so khớp mã QR
function handleQRScanned(scannedToken, session, cid) {
    const now = getNow();
    const timeBlock = Math.floor(now / 15000); // Khớp với 15s của Admin
    
    // Tạo token đối chứng dựa trên salt của session vừa lấy về
    // Lưu ý: SECRET_KEY phải khớp hoàn toàn với file admin.html
    const secret = "HàngHải2026@Secure"; 
    const validToken = CryptoJS.HmacSHA256(`${cid}_${timeBlock}_${session.salt}`, secret).toString();
    const prevToken = CryptoJS.HmacSHA256(`${cid}_${timeBlock - 1}_${session.salt}`, secret).toString();

    // Cho phép sai số 1 block (để bù độ trễ mạng)
    if (scannedToken === validToken || scannedToken === prevToken) {
        html5QrcodeScanner.stop().then(() => {
            qrReaderDiv.style.display = "none";
            statusDiv.innerHTML = "✅ Mã QR hợp lệ! Đang chuẩn bị quét mặt...";
            startFaceCamera(); // Chuyển sang bước tiếp theo
        });
    } else {
        statusDiv.innerHTML = "❌ Mã QR không khớp hoặc đã hết hạn!";
        statusDiv.style.color = "red";
    }
}

// ==========================================
// 5. LOGIC NHẬN DIỆN MẶT ĐA GÓC ĐỘ & LIVENESS
// ==========================================
async function startFaceCamera() {
    // Ẩn status cũ bên dưới, hiện container camera mới
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

    // ... (Phần load AI FaceMatcher giữ nguyên) ...

    const scanInterval = setInterval(async () => {
        const detection = await faceapi.detectSingleFace(video, detectorOptions).withFaceLandmarks().withFaceDescriptor();
        
        if (detection) {
            const landmarks = detection.landmarks.positions;
            const noseTip = landmarks[30].x;
            const leftEdge = landmarks[0].x;
            const rightEdge = landmarks[16].x;
            const turnRatio = (noseTip - leftEdge) / (rightEdge - noseTip);

            if (livenessState === "CHECK_FACE") {
                const match = faceMatcher.findBestMatch(detection.descriptor);
                if (match.label !== "unknown") {
                    finalDistance = match.distance.toFixed(2);
                    livenessState = "CHECK_TURN";
                    
                    // Cập nhật hướng dẫn ngay trên màn hình
                    camInstruction.innerHTML = "✅ Khớp mặt! <br>QUAY ĐẦU SANG TRÁI/PHẢI";
                    camInstruction.style.color = "#ffeb3b"; // Màu vàng cho nổi bật
                } else {
                    camInstruction.innerHTML = "Hãy nhìn thẳng vào khung xanh";
                    camInstruction.style.color = "#fff";
                }
            } 
            else if (livenessState === "CHECK_TURN") {
                if (turnRatio > 1.7 || turnRatio < 0.6) { 
                    livenessState = "SUCCESS";
                    camInstruction.innerHTML = "🎉 XÁC THỰC THÀNH CÔNG!";
                    camInstruction.style.color = "#00ff00";
                    clearInterval(scanInterval);
                    completeAttendance(finalDistance);
                }
            }
        } else {
            camInstruction.innerHTML = "Căn chỉnh mặt vào giữa khung";
        }
    }, 300);
}

// ==========================================
// 6. HOÀN TẤT VÀ GỬI DỮ LIỆU (BẢO MẬT HMAC)
// ==========================================
function completeAttendance(distance) {
    video.pause();
    if(video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());

    document.getElementById('camera-container').style.display = "none";
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "⏳ Đang gửi dữ liệu...";
    
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

// ==========================================
// 7. TÍNH NĂNG THÊM SHORTCUT (ADD TO HOME SCREEN)
// ==========================================

// Hàm kiểm tra xem có đang mở bằng Shortcut (Standalone) hay không
function isStandalone() {
    return (window.matchMedia('(display-mode: standalone)').matches) || 
           (window.navigator.standalone) || 
           document.referrer.includes('android-app://');
}

// Hàm hiển thị hướng dẫn
function showPwaInstructions() {
    // 1. Nếu đang mở từ Shortcut trên màn hình -> Không hiện
    if (isStandalone()) return;

    // 2. Nếu sinh viên đã từng bấm "Đóng" popup này trước đó -> Không hiện
    if (localStorage.getItem("KHH_PWA_CLOSED")) return;

    const pwaPopup = document.getElementById('pwa-popup');
    const pwaText = document.getElementById('pwa-text');
    const btnInstall = document.getElementById('btnInstall');

    // Nhận diện HĐH
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);

    if (isIOS) {
        // Hướng dẫn cho iPhone (Safari)
        pwaText.innerHTML = "Chạm vào biểu tượng <b>Chia sẻ</b> (hình vuông có mũi tên lên 📤) ở thanh công cụ Safari dưới cùng, sau đó vuốt lên chọn <b>'Thêm vào MH chính' (Add to Home Screen) ➕</b> để tạo App.";
        pwaPopup.style.display = "block";
    } else if (isAndroid) {
        // Hướng dẫn mặc định cho Android (Chrome)
        pwaText.innerHTML = "Nhấn vào <b>dấu 3 chấm ⋮</b> ở góc trên bên phải trình duyệt, chọn <b>'Thêm vào Màn hình chính'</b> để tiện điểm danh lần sau.";
        pwaPopup.style.display = "block";
    }

    // Bắt sự kiện tự động của Android Chrome (Nếu trình duyệt hỗ trợ tạo nút tự động)
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Ngăn trình duyệt tự hiện thông báo mặc định
        e.preventDefault();
        deferredPrompt = e;
        
        // Cập nhật lại nội dung và hiện nút "Cài đặt ngay"
        pwaText.innerHTML = "Bạn có thể cài đặt ứng dụng này ra màn hình chính để điểm danh nhanh chóng cho những lần sau!";
        btnInstall.style.display = "inline-block";
        pwaPopup.style.display = "block";

        // Logic khi bấm nút Cài đặt
        btnInstall.addEventListener('click', () => {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    pwaPopup.style.display = 'none';
                }
                deferredPrompt = null;
            });
        });
    });
}

// Hàm đóng Popup và lưu vào bộ nhớ để không làm phiền lần sau
function closePwaPopup() {
    document.getElementById('pwa-popup').style.display = 'none';
    localStorage.setItem("KHH_PWA_CLOSED", "true"); 
}

// Kích hoạt hàm kiểm tra khi trang web vừa tải xong
window.addEventListener('load', showPwaInstructions);