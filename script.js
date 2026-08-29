(function() {
    "use strict";

    // --- 1. CHỐNG GIAN LẬN DEVTOOLS (KẾ THỪA 100%) ---
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => {
        if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J")) || (e.ctrlKey && e.key === "u")) {
            e.preventDefault(); return false;
        }
    });
    setInterval(() => { (function() { return function(a) {} }).constructor("debugger")(); }, 50);

    // --- 2. BIẾN BẢO MẬT & CẤU HÌNH ---
    const STUDENT_ID = localStorage.getItem("KHH_STUDENT_ID");
    const DEVICE_TOKEN = localStorage.getItem("KHH_DEVICE_TOKEN");
    const SECRET_KEY = "HàngHải2026@Secure"; 
    const FB_URL = "https://hanghai-6f86f-default-rtdb.asia-southeast1.firebasedatabase.app"; 

    let serverTimeOffset = 0;
    let html5QrcodeScanner;
    let isSubmitting = false;
    let activeClassId = null;

    // Quản lý lỗi bảo mật (KẾ THỪA 100%)
    function setSecureFailCount(count) {
        const encoded = btoa("KHH_" + count + "_SECURE");
        localStorage.setItem("KHH_LOCK_DATA", encoded);
    }
    function getSecureFailCount() {
        const data = localStorage.getItem("KHH_LOCK_DATA");
        if (!data) return 0;
        try {
            const decoded = atob(data);
            const parts = decoded.split("_");
            if (parts[0] !== "KHH" || parts[2] !== "SECURE") return 99; 
            return parseInt(parts[1]);
        } catch(e) { return 99; }
    }

    let failCount = getSecureFailCount();
    let lockUntil = parseInt(localStorage.getItem("KHH_LOCK_UNTIL") || "0");

    const statusDiv = document.getElementById('status');
    const btnStart = document.getElementById('btnStart');
    const video = document.getElementById('video');

    if (!STUDENT_ID || !DEVICE_TOKEN) {
        document.body.innerHTML = `<div style="padding:40px; text-align:center;"><h2>🚫 THIẾT BỊ CHƯA XÁC THỰC</h2><p>Vui lòng đăng ký tại VP Giáo vụ.</p></div>`;
        return;
    }

    // --- 3. TIỆN ÍCH HỆ THỐNG ---
    async function syncTime() {
        try {
            const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh');
            const data = await res.json();
            serverTimeOffset = new Date(data.datetime).getTime() - Date.now();
            if(statusDiv.innerText.includes("khởi tạo")) statusDiv.innerText = "Hệ thống sẵn sàng!";
        } catch(e) { console.error("Time sync failed"); }
    }
    const getNow = () => Date.now() + serverTimeOffset;
    const getTodayStr = () => new Date(getNow()).toISOString().split('T')[0];
    const getDist = (l1, n1, l2, n2) => {
        const R = 6371; const dL = (l2-l1)*Math.PI/180; const dN = (n2-n1)*Math.PI/180;
        const a = Math.sin(dL/2)*Math.sin(dL/2) + Math.cos(l1*Math.PI/180)*Math.cos(l2*Math.PI/180)*Math.sin(dN/2)*Math.sin(dN/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    function isLocked() {
        const now = Date.now();
        if (failCount > 5 || now < lockUntil) {
            const min = Math.ceil((lockUntil - now) / 60000);
            statusDiv.innerHTML = `<b style="color:red;">🚫 HỆ THỐNG ĐANG KHÓA</b><br>Thử lại sau ${min > 0 ? min : 0} phút.`;
            return true;
        }
        return false;
    }

    function handleFailure(msg) {
        failCount++; setSecureFailCount(failCount);
        if (failCount >= 5) {
            lockUntil = Date.now() + (3 * 60 * 1000);
            localStorage.setItem("KHH_LOCK_UNTIL", lockUntil);
            statusDiv.innerHTML = `<b style="color:red;">🚫 KHÓA 3 PHÚT!</b>`;
        } else {
            statusDiv.innerHTML = `<b style="color:red;">❌ LỖI: ${msg}</b> (${failCount}/5)`;
        }
    }

    // --- 4. KHỞI CHẠY ĐỒNG THỜI ĐỐI SOÁT ĐỊNH TUYẾN ĐIỂM DANH ---
    window.startProcess = async function() {
        if (isLocked()) return;
        statusDiv.innerHTML = "🔍 Đang rà soát danh sách ca học & ca thực tập doanh nghiệp...";
        btnStart.style.display = "none";
        
        try {
            await syncTime();
            
            // Đọc song song dữ liệu từ Firebase tuân thủ Rules
            const [
                activeClasses, 
                activeInternships, 
                schoolCheckins, 
                internshipCheckins, 
                schoolRoster, 
                internshipRoster
            ] = await Promise.all([
                fetch(`${FB_URL}/active_sessions.json`).then(r => r.json() || {}),
                fetch(`${FB_URL}/active_internship_sessions.json`).then(r => r.json() || {}),
                fetch(`${FB_URL}/checkins.json?orderBy="student_id"&equalTo="${STUDENT_ID}"`).then(r => r.json() || {}),
                fetch(`${FB_URL}/internship_checkins.json?orderBy="student_id"&equalTo="${STUDENT_ID}"`).then(r => r.json() || {}),
                fetch(`${FB_URL}/student_classes/${STUDENT_ID}.json`).then(r => r.json() || {}),
                fetch(`${FB_URL}/internship_rosters.json`).then(r => r.json() || {})
            ]);

            const today = getTodayStr();

            // QUY TRÌNH 1: ƯU TIÊN KIỂM TRA LỊCH LÝ THUYẾT Ở TRƯỜNG
            let activeClassId = null;
            let targetClassSession = null;
            
            const schoolCheckedInList = Object.values(schoolCheckins).filter(rec => 
                new Date(rec.timestamp).toISOString().split('T')[0] === today
            );

            for (let cid in activeClasses) {
                if (schoolRoster[cid]) {
                    const sess = activeClasses[cid];
                    const currentIdx = sess.lesson_index || 0;
                    const alreadyDone = schoolCheckedInList.some(r => r.class_id === cid && (r.lesson_index || 0) === currentIdx);
                    
                    if (!alreadyDone) {
                        targetClassSession = sess; 
                        activeClassId = cid; 
                        break;
                    }
                }
            }

            if (activeClassId) {
                startGPSAndQRFlow(targetClassSession, activeClassId, false);
                return;
            }

            // QUY TRÌNH 2: KIỂM TRA LỊCH THỰC TẬP TẠI DOANH NGHIỆP
            let activeBusinessId = null;
            let targetInternSession = null;
            
            const internCheckedInList = Object.values(internshipCheckins).filter(rec => 
                new Date(rec.timestamp).toISOString().split('T')[0] === today
            );

            for (let bid in activeInternships) {
                const studentRoster = internshipRoster[bid]?.students?.[STUDENT_ID];
                if (studentRoster && studentRoster.date === today) {
                    const sess = activeInternships[bid];
                    // Kiểm tra trùng lặp dựa trên cả mã doanh nghiệp và loại lần quét (Đầu ca / Cuối ca)
                    const alreadyDone = internCheckedInList.some(r => 
                        (r.class_id === bid || r.business_id === bid) && 
                        (r.checkin_type || 0) === (sess.lesson_index || 0)
                    );
                    
                    if (!alreadyDone) {
                        targetInternSession = sess;
                        activeBusinessId = bid;
                        break;
                    }
                }
            }

            if (activeBusinessId) {
                // Đóng gói lịch trình để lấy schedule_id chuyển xuống QR Flow
                const rosterDetails = internshipRoster[activeBusinessId].students[STUDENT_ID];
                targetInternSession.schedule_id = rosterDetails.schedule_id;
                startGPSAndQRFlow(targetInternSession, activeBusinessId, true);
                return;
            }

            statusDiv.innerHTML = "❌ Không phát hiện ca học hoặc ca thực tập được phân bổ khả dụng hôm nay.";
            btnStart.style.display = "inline-block";

        } catch (e) {
            console.error(e);
            statusDiv.innerHTML = "❌ Lỗi kết nối hệ thống dữ liệu hoặc quyền truy cập bị chặn!";
            btnStart.style.display = "inline-block";
        }
    };

    function startGPSAndQRFlow(session, targetId, isInternship) {
        navigator.geolocation.getCurrentPosition((pos) => {
            // Xác thực sai lệch định vị GPS 300m
            if (getDist(pos.coords.latitude, pos.coords.longitude, session.lat, session.lon) > 0.3) {
                statusDiv.innerHTML = isInternship ? "❌ Định vị phát hiện bạn đang ở ngoài khu vực Doanh nghiệp (300m)!" : "❌ Định vị phát hiện bạn ngoài khu vực trường học (300m)!" ;
                btnStart.style.display = "inline-block";
            } else {
                document.getElementById('reader').style.display = "block";
                html5QrcodeScanner = new Html5Qrcode("reader");
                html5QrcodeScanner.start(
                    { facingMode: "environment" }, 
                    { fps: 15, qrbox: 250 }, 
                    (txt) => handleQRScanned(txt, session, targetId, isInternship)
                );
            }
        }, (err) => { 
            statusDiv.innerHTML = "🚫 Thiết bị chưa bật định vị GPS có độ chính xác cao!"; 
            btnStart.style.display = "inline-block"; 
        }, { enableHighAccuracy: true });
    }

    // --- 4. QUÉT QR (CẢI TIẾN: THÊM LESSON_INDEX) ---
    function handleQRScanned(decodedText, session, targetId, isInternship) {
        if (isLocked()) return;
        const now = getNow();
        const timeBlock = Math.floor(now / 10000); // 15s rotating
        
        const lessonIdx = session.lesson_index || 0;
        
        // Sinh mã Token kiểm chứng
        const validToken = CryptoJS.HmacSHA256(`${targetId}_${timeBlock}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();
        const prevToken = CryptoJS.HmacSHA256(`${targetId}_${timeBlock - 1}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();

        let scannedToken = decodedText.startsWith("R:") ? decodedText.replace("R:", "").split("|")[0] : decodedText;

        if (scannedToken !== validToken && scannedToken !== prevToken) {
            handleFailure("Mã QR không khớp hoặc phiên điểm danh hết hạn!"); 
            return;
        }

        failCount = 0; setSecureFailCount(0);
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = "none";
            startFaceCamera(session, targetId, isInternship);
        });
    }

    // --- 5. QUÉT MẶT & XÁC MINH SỰ SỐNG (LIVENESS) ---
    async function startFaceCamera(session, targetId, isInternship) {
        document.getElementById('camera-container').style.display = "block";
        statusDiv.style.display = "none";
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            video.srcObject = stream;
        } catch (e) { alert("Thiếu quyền truy cập Camera!"); return; }

        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
        const savedData = JSON.parse(CryptoJS.AES.decrypt(localStorage.getItem("KHH_FACE_DATA"), DEVICE_TOKEN).toString(CryptoJS.enc.Utf8));
        const matcher = new faceapi.FaceMatcher([new faceapi.LabeledFaceDescriptors(STUDENT_ID, savedData.map(d => new Float32Array(d)))], 0.4);

        let livenessState = "CHECK_FACE";
        const scanInterval = setInterval(async () => {
            const d = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
            if (d) {
                if (livenessState === "CHECK_FACE") {
                    if (matcher.findBestMatch(d.descriptor).label !== "unknown") {
                        livenessState = "CHECK_TURN";
                        document.getElementById('cam-instruction').innerHTML = "✅ KHỚP MẶT! <br>QUAY ĐẦU SANG TRÁI HOẶC SANG PHẢI";
                    }
                } else {
                    const l = d.landmarks.positions;
                    const ratio = (l[30].x - l[0].x) / (l[16].x - l[30].x);
                    if (ratio > 1.6 || ratio < 0.7) { 
                        clearInterval(scanInterval); 
                        completeAttendance(session, targetId, isInternship); 
                    }
                }
            }
        }, 500);
    }

    // Hàm chụp ảnh từ Video và nén xuống dung lượng cực thấp
    async function captureAndCompress(videoElement) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // 1. Giới hạn kích thước ảnh (Chiều rộng tối đa 480px - Đủ để nhận diện mặt)
            const maxWidth = 480;
            const scale = maxWidth / videoElement.videoWidth;
            canvas.width = maxWidth;
            canvas.height = videoElement.videoHeight * scale;

            // 2. Vẽ ảnh từ Video vào Canvas
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

            // 3. Xuất ảnh sang định dạng JPEG với chất lượng 0.5 (50%)
            // Ở mức 0.5, dung lượng sẽ giảm khoảng 90% nhưng mặt vẫn rất rõ
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', 0.5); 
        });
    }

    async function completeAttendance(session, targetId, isInternship) {
        if (isSubmitting) return; 
        isSubmitting = true;

        // --- BƯỚC MỚI: CHỤP VÀ NÉN ẢNH TRƯỚC KHI TẮT CAM ---
        statusDiv.innerHTML = "⏳ Đang nén ảnh & xác thực...";
        const compressedImageBlob = await captureAndCompress(video);

        // Sau khi đã có ảnh trong bộ nhớ, giờ mới tắt Camera
        if(video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
        document.getElementById('camera-container').style.display = "none";
        statusDiv.style.display = "block"; 

        const now = getNow();
        const lessonIdx = session.lesson_index || 0;

        // Tạo FormData để gửi cả thông tin và file ảnh
        const formData = new FormData();
        formData.append("student_id", STUDENT_ID);
        formData.append("timestamp", now);
        
        // Gửi file ảnh đã nén (đặt tên là image để khớp với Flask)
        formData.append("image", compressedImageBlob, `${STUDENT_ID}.jpg`);

        if (isInternship) {
            const scheduleId = session.schedule_id || 0; 
            const signature = CryptoJS.HmacSHA256(`${STUDENT_ID}_${targetId}_${scheduleId}_${now}`, SECRET_KEY).toString();
            
            formData.append("business_id", targetId);
            formData.append("schedule_id", scheduleId);
            formData.append("signature", signature);
            // Gửi kèm thông tin loại lần quét thực tập (0, 101 hoặc 102)
            formData.append("lesson_index", session.lesson_index || 0); 
            var targetUrl = `${FB_URL}/internship_checkins.json`;
        } else {
            const signature = CryptoJS.HmacSHA256(`${STUDENT_ID}_${targetId}_${now}_${lessonIdx}`, SECRET_KEY).toString();
            formData.append("class_id", targetId);
            formData.append("lesson_index", lessonIdx);
            formData.append("signature", signature);
            var targetUrl = `${FB_URL}/checkins.json`;
        }

        // --- GỬI FILE VÀ DỮ LIỆU VỀ SERVER FLASK CỦA TRƯỜNG ---
        try {
            // 1. Lấy link server từ Firebase (để luôn đúng địa chỉ tunnel mới nhất)
            const configRes = await fetch(`${FB_URL}/server_config.json`);
            const config = await configRes.json();
            const flaskUrl = config.upload_url; // Ví dụ: https://xyz.trycloudflare.com/upload_evidence

            // 2. Gửi ảnh về Server Flask
            const uploadRes = await fetch(flaskUrl, {
                method: "POST",
                body: formData // FormData chứa ảnh đã nén
            });

            if (uploadRes.ok) {
                // 3. Sau khi server Flask nhận ảnh thành công, mới ghi record lên Firebase để báo cáo
                // (Hoặc bạn có thể cho Flask tự làm việc này để máy sinh viên không phải gửi 2 lần)
                statusDiv.innerHTML = `<h3 style="color:green;">🎉 ĐIỂM DANH THÀNH CÔNG!</h3>`;
                activateRelayMode(session, targetId, isInternship);
            } else {
                handleFailure("Server ảnh không phản hồi. Vui lòng thử lại!");
                isSubmitting = false;
            }
        } catch (err) {
            handleFailure("Lỗi kết nối Server ảnh (Có thể server đang tắt)");
            isSubmitting = false;
        }
    }

    

    // --- 7. CHẾ ĐỘ TIẾP SỨC (KẾ THỪA & CẬP NHẬT) ---
    function activateRelayMode(session, targetId, isInternship) {
        if (localStorage.getItem("KHH_SUPPORT_BANNED") === "true") return;
        const relayDiv = document.createElement('div');
        relayDiv.id = "relay-container";
        relayDiv.innerHTML = `<div style="padding:15px; text-align:center; background:white; border-radius:15px; margin-top:20px; border:3px solid #28a745;">
            <h3 style="color:#28a745;">🌟 CHẾ ĐỘ TIẾP SỨC</h3>
            <div id="relayQr" style="display:flex; justify-content:center; margin:10px 0;"></div>
            <p>Phiên hỗ trợ đóng sau: <span id="relayTimer">60</span>s</p>
        </div>`;
        document.body.appendChild(relayDiv);

        let relayQr = new QRCode(document.getElementById("relayQr"), { width: 200, height: 200 });
        let relayStart = getNow();
        const lessonIdx = session.lesson_index || 0;

        const relayInterval = setInterval(() => {
            const elapsed = getNow() - relayStart;
            if (elapsed > 60000) { clearInterval(relayInterval); relayDiv.remove(); return; }
            document.getElementById('relayTimer').innerText = Math.floor((60000 - elapsed) / 1000);
            
            let token = CryptoJS.HmacSHA256(`${targetId}_${Math.floor(getNow() / 10000)}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();
            relayQr.makeCode(token);
        }, 1000);
    }
    
    
    window.closePwaPopup = function() { document.getElementById('pwa-popup').style.display = 'none'; };

    syncTime();
    Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('./models')
    ]).then(() => { btnStart.style.display = "inline-block"; });

})();