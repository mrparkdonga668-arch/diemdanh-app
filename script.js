const video = document.getElementById('video');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');

// Tọa độ giả định của trường học (Bạn thay bằng tọa độ thực tế trên Google Maps)
const SCHOOL_LAT = 20.897007783267334;
const SCHOOL_LON = 106.67248743684335;

// 1. TẢI MÔ HÌNH AI KHI MỞ WEB
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models')
]).then(() => {
    statusDiv.innerHTML = "Sẵn sàng! Hãy bấm nút bên dưới.";
    statusDiv.style.color = "blue";
    btnStart.style.display = "inline-block";
}).catch((error) => {
    // Thêm dòng catch này để nếu lỗi nó sẽ báo đỏ lên màn hình cho dễ sửa
    statusDiv.innerHTML = "❌ Lỗi không tải được Model: " + error.message;
});

// Hàm tính khoảng cách GPS (Công thức Haversine)
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

// 2. KHI SINH VIÊN BẤM NÚT "BẮT ĐẦU"
function startProcess() {
    statusDiv.innerHTML = "Đang kiểm tra vị trí GPS...";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let dist = getDistanceFromLatLonInKm(position.coords.latitude, position.coords.longitude, SCHOOL_LAT, SCHOOL_LON);
                
                // Cho phép sai số 0.2 km (200 mét)
                if (dist > 0.2) {
                    statusDiv.innerHTML = `❌ Lỗi: Bạn đang cách trường ${Math.round(dist*1000)} mét. Vui lòng vào lớp!`;
                } else {
                    statusDiv.innerHTML = "✅ Vị trí hợp lệ. Đang bật Camera...";
                    startCamera(); // Bật camera quét mặt
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

// 3. BẬT CAMERA VÀ XỬ LÝ NHẬN DIỆN MẶT
async function startCamera() {
    video.style.display = "block";
    btnStart.style.display = "none";
    
    try {
        // Yêu cầu camera trước (facingMode: "user")
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
    } catch (err) {
        statusDiv.innerHTML = "❌ Lỗi: Không thể mở Camera.";
    }
}

// 4. CHẠY AI SO SÁNH KHI CAMERA ĐANG PHÁT
video.addEventListener('play', async () => {
    statusDiv.style.color = "blue";
    statusDiv.innerHTML = "Đang tải ảnh hồ sơ để đối chiếu...";
    
    try {
        // Bước A: Tải ảnh gốc
        const refImage = await faceapi.fetchImage('./anh_goc.jpg');
        const refDetection = await faceapi.detectSingleFace(refImage, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
        
        if (!refDetection) {
            statusDiv.style.color = "red";
            statusDiv.innerHTML = "❌ Lỗi: Ảnh gốc không đủ tiêu chuẩn (AI không thấy mặt).";
            return;
        }
        
        // Ngưỡng 0.5 (Càng nhỏ càng khắt khe. Nếu khó nhận diện quá, bạn có thể tăng lên 0.55 hoặc 0.6)
        const faceMatcher = new faceapi.FaceMatcher(refDetection.descriptor, 0.5); 
        
        statusDiv.innerHTML = "Đang quét khuôn mặt. Vui lòng nhìn thẳng...";

        // Bước B: Vòng lặp quét Camera
        const scanInterval = setInterval(async () => {
            try {
                // Chống lỗi video chưa kịp load kích thước trên điện thoại
                if (video.videoWidth === 0 || video.videoHeight === 0) return;

                const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
                
                if (detection) {
                    const match = faceMatcher.findBestMatch(detection.descriptor);
                    
                    if (match.label !== "unknown") {
                        clearInterval(scanInterval); // Dừng quét
                        video.pause(); // Dừng camera
                        
                        statusDiv.style.color = "green";
                        // In luôn sai số ra màn hình để bạn dễ xem (VD: Sai số: 0.42)
                        let distanceStr = (Math.round(match.distance * 100) / 100).toString();
                        statusDiv.innerHTML = `✅ ĐIỂM DANH THÀNH CÔNG! (Sai số: ${distanceStr})`;
                    } else {
                        statusDiv.style.color = "orange";
                        statusDiv.innerHTML = "⚠️ Khuôn mặt không khớp! Đang quét lại...";
                    }
                } else {
                    // Nếu bị lóa sáng, che mặt... AI sẽ báo dòng này thay vì im lặng
                    statusDiv.style.color = "red";
                    statusDiv.innerHTML = "❌ Không nhìn thấy khuôn mặt. Đưa mặt vào giữa và tìm nơi sáng hơn!";
                }
            } catch (err) {
                console.error(err);
                clearInterval(scanInterval);
                statusDiv.innerHTML = "❌ Lỗi xử lý AI: " + err.message;
            }
        }, 1000); // Quét 1 giây 1 lần

    } catch (error) {
        statusDiv.style.color = "red";
        statusDiv.innerHTML = "❌ Lỗi không tải được ảnh gốc. Kiểm tra lại tên file anh_goc.jpg";
    }
});