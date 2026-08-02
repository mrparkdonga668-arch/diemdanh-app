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

    // --- 4. QUÉT QR (CẢI TIẾN: THÊM LESSON_INDEX) ---
    function handleQRScanned(decodedText, session) {
        if (isLocked()) return;
        const now = getNow();
        const timeBlock = Math.floor(now / 5000);
        
        // CẢI TIẾN: Lấy index từ giảng viên
        const lessonIdx = session.lesson_index || 0;

        // KẾ THỪA: So khớp cả block hiện tại và block trước đó (tránh lệch giây)
        const validToken = CryptoJS.HmacSHA256(`${activeClassId}_${timeBlock}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();
        const prevToken = CryptoJS.HmacSHA256(`${activeClassId}_${timeBlock - 1}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();

        let scannedToken = decodedText.startsWith("R:") ? decodedText.replace("R:", "").split("|")[0] : decodedText;

        if (scannedToken !== validToken && scannedToken !== prevToken) {
            handleFailure("Mã QR không khớp hoặc sai tiết học."); return;
        }

        failCount = 0; setSecureFailCount(0);
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = "none";
            startFaceCamera(session);
        });
    }

    // --- 5. QUÉT MẶT & LIVENESS (KẾ THỪA 100%) ---
    async function startFaceCamera(session) {
        document.getElementById('camera-container').style.display = "block";
        statusDiv.style.display = "none";
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            video.srcObject = stream;
        } catch (e) { alert("Lỗi camera!"); return; }

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
                        document.getElementById('cam-instruction').innerHTML = "✅ KHỚP MẶT! <br>QUAY ĐẦU SANG TRÁI hoặc PHẢI";
                    }
                } else {
                    const l = d.landmarks.positions;
                    const ratio = (l[30].x - l[0].x) / (l[16].x - l[30].x);
                    if (ratio > 1.6 || ratio < 0.7) { 
                        clearInterval(scanInterval); 
                        completeAttendance(session); 
                    }
                }
            }
        }, 500);
    }

    // --- 6. HOÀN TẤT & GỬI DỮ LIỆU (CẢI TIẾN PAYLOAD) ---
    function completeAttendance(session) {
        if (isSubmitting) return; isSubmitting = true;
        if(video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
        document.getElementById('camera-container').style.display = "none";
        statusDiv.style.display = "block"; statusDiv.innerHTML = "⏳ Đang gửi kết quả...";

        const now = getNow();
        const lessonIdx = session.lesson_index || 0;

        // CẢI TIẾN: Chữ ký bao gồm cả lesson_index
        const signature = CryptoJS.HmacSHA256(`${STUDENT_ID}_${activeClassId}_${now}_${lessonIdx}`, SECRET_KEY).toString();
        
        fetch(`${FB_URL}/checkins.json`, { 
            method: "POST", 
            body: JSON.stringify({ 
                student_id: STUDENT_ID, 
                class_id: activeClassId, 
                timestamp: now, 
                lesson_index: lessonIdx, // CẢI TIẾN
                signature: signature 
            }) 
        }).then(res => {
            if (res.ok) {
                statusDiv.innerHTML = `<h3 style="color:green;">🎉 ĐIỂM DANH THÀNH CÔNG!</h3>`;
                activateRelayMode(session);
            } else { handleFailure("Lỗi xác thực"); isSubmitting = false; }
        }).catch(err => { handleFailure("Lỗi mạng"); isSubmitting = false; });
    }

    // --- 7. CHẾ ĐỘ TIẾP SỨC (KẾ THỪA & CẬP NHẬT) ---
    function activateRelayMode(session) {
        if (localStorage.getItem("KHH_SUPPORT_BANNED") === "true") return;
        const relayDiv = document.createElement('div');
        relayDiv.id = "relay-container";
        relayDiv.innerHTML = `<div style="padding:15px; text-align:center; background:white; border-radius:15px; margin-top:20px; border:3px solid #28a745;">
            <h3 style="color:#28a745;">🌟 TIẾP SỨC</h3>
            <div id="relayQr" style="display:flex; justify-content:center; margin:10px 0;"></div>
            <p>Hết hạn: <span id="relayTimer">60</span>s</p>
        </div>`;
        document.body.appendChild(relayDiv);

        let relayQr = new QRCode(document.getElementById("relayQr"), { width: 200, height: 200 });
        let relayStart = getNow();
        const lessonIdx = session.lesson_index || 0;

        const relayInterval = setInterval(() => {
            const elapsed = getNow() - relayStart;
            if (elapsed > 60000) { clearInterval(relayInterval); relayDiv.remove(); return; }
            document.getElementById('relayTimer').innerText = Math.floor((60000 - elapsed) / 1000);
            
            // CẢI TIẾN: Token tiếp sức cũng mang lesson_index
            let token = CryptoJS.HmacSHA256(`${activeClassId}_${Math.floor(getNow() / 5000)}_${session.salt}_${lessonIdx}`, SECRET_KEY).toString();
            relayQr.makeCode(token);
        }, 1000);
    }

    // --- 8. KHỞI CHẠY (CẢI TIẾN LOGIC KIỂM TRA TRÙNG TIẾT) ---
    window.startProcess = async function() {
        if (isLocked()) return;
        statusDiv.innerHTML = "🔍 Đang kiểm tra lớp học...";
        btnStart.style.display = "none";
        try {
            await syncTime();
            const [sessionsRes, checkinsRes, classesRes] = await Promise.all([
                fetch(`${FB_URL}/active_sessions.json`).then(r => r.json()),
                fetch(`${FB_URL}/checkins.json?orderBy="student_id"&equalTo="${STUDENT_ID}"`).then(r => r.json()),
                fetch(`${FB_URL}/classes.json`).then(r => r.json())
            ]);
            
            const today = getTodayStr();
            const checkedInList = checkinsRes ? Object.values(checkinsRes).filter(rec => 
                new Date(rec.timestamp).toISOString().split('T')[0] === today
            ) : [];

            let targetSession = null; activeClassId = null;
            for (let cid in sessionsRes) {
                if (classesRes[cid]?.students?.[STUDENT_ID]) {
                    const sess = sessionsRes[cid];
                    const currentIdx = sess.lesson_index || 0;

                    // CẢI TIẾN: Chỉ chặn nếu đã điểm danh ĐÚNG TIẾT NÀY của LỚP NÀY
                    const alreadyDone = checkedInList.some(r => r.class_id === cid && (r.lesson_index || 0) === currentIdx);
                    
                    if (!alreadyDone) {
                        targetSession = sess; activeClassId = cid; break;
                    }
                }
            }

            if (!activeClassId) {
                statusDiv.innerHTML = "❌ Bạn đã điểm danh tiết này rồi hoặc không có ca học."; 
                btnStart.style.display = "inline-block"; return;
            }

            navigator.geolocation.getCurrentPosition((pos) => {
                if (getDist(pos.coords.latitude, pos.coords.longitude, targetSession.lat, targetSession.lon) > 0.3) {
                    statusDiv.innerHTML = "❌ Ngoài phạm vi lớp học (300m)!"; btnStart.style.display = "inline-block";
                } else {
                    document.getElementById('reader').style.display = "block";
                    html5QrcodeScanner = new Html5Qrcode("reader");
                    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 15, qrbox: 250 }, (txt) => handleQRScanned(txt, targetSession));
                }
            }, (err) => { statusDiv.innerHTML = "🚫 Cần GPS!"; btnStart.style.display = "inline-block"; }, { enableHighAccuracy: true });
        } catch (e) { statusDiv.innerHTML = "Lỗi mạng!"; btnStart.style.display = "inline-block"; }
    };

    window.closePwaPopup = function() { document.getElementById('pwa-popup').style.display = 'none'; };

    syncTime();
    Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('./models')
    ]).then(() => { btnStart.style.display = "inline-block"; });

})();