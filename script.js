// ==========================================
// 1. KIỂM TRA THIẾT BỊ ĐÃ ĐĂNG KÝ CHƯA
// ==========================================
const STUDENT_ID = localStorage.getItem("KHH_STUDENT_ID");
const DEVICE_TOKEN = localStorage.getItem("KHH_DEVICE_TOKEN");

if (!STUDENT_ID || !DEVICE_TOKEN) {
    document.body.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; background-color: #f8f9fa; min-height: 100vh;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-top: 5px solid #dc3545;">
                <div style="font-size: 50px; color: #dc3545; margin-bottom: 15px;">🚫</div>
                <h2 style="color: #333; margin-bottom: 20px; font-size: 22px;">THIẾT BỊ CHƯA ĐƯỢC XÁC THỰC</h2>
                
                <div style="text-align: left; background: #fff5f5; border-left: 4px solid #dc3545; padding: 15px; margin-bottom: 20px;">
                    <p style="margin: 0; color: #555; font-size: 16px;">
                        Hệ thống ghi nhận thiết bị này <b>chưa được đăng ký</b> trong cơ sở dữ liệu điểm danh sinh trắc học.
                    </p>
                </div>

                <div style="text-align: left; color: #333;">
                    <p style="font-weight: bold; margin-bottom: 10px;">Để đảm bảo tính bảo mật và công bằng:</p>
                    <ul style="padding-left: 20px; color: #e63946; font-weight: 600;">
                        <li style="margin-bottom: 10px;">Vui lòng mang theo <b>Thẻ Sinh viên</b> hoặc <b>CCCD</b>.</li>
                        <li style="margin-bottom: 10px;">Trực tiếp đến <b>Văn phòng Giáo vụ Khoa</b> để được cán bộ hỗ trợ đăng ký thiết bị chính chủ.</li>
                    </ul>
                </div>

                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 13px; color: #888; font-style: italic;">
                    Lưu ý: Mỗi sinh viên chỉ được phép sử dụng một thiết bị duy nhất để thực hiện điểm danh.
                </p>
            </div>
        </div>`;
    throw new Error("Thiết bị chưa được xác thực. Yêu cầu lên phòng giáo vụ.");
}

// ==========================================
// 2. CẤU HÌNH HỆ THỐNG (THỐNG NHẤT BIẾN)
// ==========================================
const video = document.getElementById('video');
const qrReaderDiv = document.getElementById('reader');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');


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

const LIMIT_TIME = 600000; // 10 phút

// Hàm lấy ngày hiện tại (YYYY-MM-DD) theo giờ chuẩn
function getTodayString() {
    const d = new Date(getNow());
    return d.toISOString().split('T')[0];
}

async function startProcess() {
    statusDiv.innerHTML = "🔍 Đang kiểm tra dữ liệu điểm danh...";
    btnStart.style.display = "none";

    try {
        // 1. Đồng bộ thời gian chuẩn
        await syncTime();
        const today = getTodayString();

        // 2. Lấy dữ liệu từ Firebase song song để tối ưu tốc độ
        const [sessionsRes, checkinsRes, classesRes] = await Promise.all([
            fetch(`${FB_URL}/active_sessions.json`).then(r => r.json()),
            fetch(`${FB_URL}/checkins.json?orderBy="student_id"&equalTo="${STUDENT_ID}"`).then(r => r.json()),
            fetch(`${FB_URL}/classes.json`).then(r => r.json())
        ]);

        if (!sessionsRes) {
            statusDiv.innerHTML = "📭 Hiện không có lớp nào đang mở điểm danh.";
            btnStart.style.display = "inline-block";
            return;
        }

        // 3. Xác định các lớp sinh viên đã điểm danh thành công trong hôm nay
        const attendedClassIds = [];
        if (checkinsRes) {
            Object.values(checkinsRes).forEach(record => {
                const recordDate = new Date(record.timestamp).toISOString().split('T')[0];
                if (recordDate === today) {
                    attendedClassIds.push(record.class_id);
                }
            });
        }

        // 4. Tìm lớp học phù hợp (Đang mở + Có tên SV + Chưa điểm danh hôm nay)
        let targetSession = null;
        let myClassId = null;

        for (let cid in sessionsRes) {
            // Kiểm tra xem sinh viên có trong danh sách lớp này không
            const isStudentInClass = classesRes[cid] && classesRes[cid].students && classesRes[cid].students[STUDENT_ID];
            
            // Kiểm tra xem lớp này hôm nay SV đã điểm danh chưa
            const alreadyAttended = attendedClassIds.includes(cid);

            if (isStudentInClass && !alreadyAttended) {
                targetSession = sessionsRes[cid];
                myClassId = cid;
                break; // Tìm thấy lớp cần điểm danh ca này, dừng vòng lặp
            }
        }

        // 5. Kiểm tra kết quả tìm kiếm
        if (!targetSession) {
            if (attendedClassIds.length > 0) {
                statusDiv.innerHTML = `✅ Bạn đã hoàn thành điểm danh cho các lớp ca trước.<br>Hiện không có ca học mới nào dành cho bạn.`;
            } else {
                statusDiv.innerHTML = "❌ Bạn không có tên trong các lớp đang mở điểm danh.";
            }
            btnStart.style.display = "inline-block";
            return;
        }

        // 6. Kiểm tra thời gian 10 phút của lớp tìm được
        const now = getNow();
        const elapsed = now - targetSession.startTime;
        if (elapsed > LIMIT_TIME) {
            statusDiv.innerHTML = `<div style="color:red; font-weight:bold;">⚠️ QUÁ HẠN ĐIỂM DANH!</div>
                                   Lớp <b>${classesRes[myClassId].class_name}</b> đã mở quá 10 phút.`;
            btnStart.style.display = "inline-block";
            return;
        }

        // 7. Hợp lệ -> Tiến hành check GPS
        targetSession.class_id = myClassId;
        statusDiv.innerHTML = `📍 Lớp hiện tại: <b>${classesRes[myClassId].class_name}</b>.<br>Đang xác vị trí...`;
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let dist = getDistanceFromLatLonInKm(position.coords.latitude, position.coords.longitude, targetSession.lat, targetSession.lon);
                if (dist > 0.3) {
                    statusDiv.innerHTML = `❌ Bạn ở quá xa lớp học (${Math.round(dist*1000)}m).`;
                    btnStart.style.display = "inline-block";
                } else {
                    statusDiv.innerHTML = "✅ Vị trí khớp. Đang bật camera quét QR...";
                    startQRScannerAfterGPS(targetSession); 
                }
            },
            () => { 
                alert("Vui lòng bật GPS và cho phép truy cập vị trí!"); 
                btnStart.style.display = "inline-block"; 
            },
            { enableHighAccuracy: true }
        );

    } catch (e) {
        console.error(e);
        statusDiv.innerHTML = "Lỗi kết nối: " + e.message;
        btnStart.style.display = "inline-block";
    }
}



// Chỉnh sửa lại hàm quét QR để không cần fetch lại session
function startQRScannerAfterGPS(session) {
    statusDiv.innerHTML = "✅ Đang bật camera quét QR...";
    qrReaderDiv.style.display = "block";
    
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            handleQRScanned(decodedText, session);
        }
    ).catch(err => {
        statusDiv.innerHTML = "❌ Không thể mở camera. Hãy kiểm tra quyền truy cập.";
    });
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

                if (turnRatio > 1.6 || turnRatio < 0.7) { // Đã quay đầu
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
// Cập nhật lại hàm hoàn tất để ngăn chặn bấm gửi 2 lần (Double-click)
let isSubmitting = false;
function completeAttendance(descriptor, session) {
    if (isSubmitting) return;
    isSubmitting = true;

    video.pause();
    if(video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    document.getElementById('camera-container').style.display = "none";
    
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "⏳ Đang gửi kết quả lên hệ thống...";

    const now = getNow();
    const payload = {
        student_id: STUDENT_ID,
        class_id: session.class_id,
        timestamp: now,
        signature: CryptoJS.HmacSHA256(STUDENT_ID + now, session.salt).toString(),
        device: navigator.userAgent
    };

    fetch(`${FB_URL}/checkins.json`, {
        method: "POST",
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error("Firebase Reject");
        statusDiv.innerHTML = `<div style="color: green; font-size: 20px; font-weight:bold;">🎉 ĐIỂM DANH THÀNH CÔNG!</div>
                               <p>Bạn đã hoàn thành lớp: ${session.class_id}</p>`;
        activateRelayMode(session);
    })
    .catch(err => {
        statusDiv.innerHTML = `<div style="color: red;">❌ LỖI GỬI DỮ LIỆU. Hãy thử lại.</div>`;
        btnStart.style.display = "inline-block";
        isSubmitting = false;
    });
}

// CHẾ ĐỘ TIẾP SỨC
function activateRelayMode(session) {
    // 1. Kiểm tra xem đã có relayDiv chưa để tránh hiện 2 cái nếu SV bấm lại
    if (document.getElementById('relay-container')) return;

    const relayDiv = document.createElement('div');
    relayDiv.id = "relay-container"; // Thêm ID để quản lý
    relayDiv.innerHTML = `
        <div style="padding:20px; text-align:center; background:white; border-radius:15px; margin-top:20px; border:3px solid #28a745; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
            <h3 style="color:#28a745; margin-top:0;">🌟 TRẠM TIẾP SỨC</h3>
            <p>Bạn đã điểm danh xong. Hãy cho bạn khác quét mã này để hỗ trợ.</p>
            <div id="relayQr" style="display:flex; justify-content:center; margin: 15px 0;"></div>
            <p style="font-size: 14px; color: #666;">Mã sẽ tự động đổi theo thời gian thực</p>
            <p style="font-weight:bold; color:red;">Hết hạn sau: <span id="relayTimer">300</span>s</p>
        </div>`;
    document.body.appendChild(relayDiv);
    
    // 2. Khởi tạo QRCode
    let relayQr = new QRCode(document.getElementById("relayQr"), { 
        width: 200, 
        height: 200,
        correctLevel : QRCode.CorrectLevel.M // Độ lọc mức trung bình để quét nhanh trên màn hình điện thoại
    });

    let relayStart = getNow();
    const LIMIT_TIME = 60000; // Thay đổi thành 60.000 ms (tương đương 60 giây)

    // 3. Đặt vào biến để có thể Clear (dừng) vòng lặp
    const relayInterval = setInterval(() => {
        const now = getNow();
        const elapsed = now - relayStart;

        // Nếu hết thời gian 60 giây, dừng vòng lặp và thông báo hết thời gian
        if (elapsed > LIMIT_TIME) { 
            clearInterval(relayInterval); // DỪNG VÒNG LẶP (QUAN TRỌNG)
            document.getElementById('relay-container').innerHTML = `
                <div style="padding:20px; text-align:center;">
                    <b style="color:gray;">⌛ Hết thời gian hỗ trợ tiếp sức (60s).</b><br>
                    <p>Cảm ơn bạn đã tham gia điểm danh!</p>
                </div>`;
            return; 
        }

        // Cập nhật đồng hồ
        const timerElement = document.getElementById('relayTimer');
        if (timerElement) {
            timerElement.innerText = Math.floor((LIMIT_TIME - elapsed)/1000);
        }

        // Tạo mã Token khớp với thời gian thực của hệ thống
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