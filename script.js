const video = document.getElementById('video');
const statusDiv = document.getElementById('status');
const btnStart = document.getElementById('btnStart');

// Tọa độ giả định của trường học (Bạn thay bằng tọa độ thực tế trên Google Maps)
const SCHOOL_LAT = 21.037; 
const SCHOOL_LON = 105.783;

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
    statusDiv.innerHTML = "Đang quét khuôn mặt. Vui lòng nhìn thẳng...";
    
    // Bước A: Trích xuất khuôn mặt từ ảnh gốc (Chỉ làm 1 lần)
    const refImage = document.getElementById('referenceImage');
    const refDetection = await faceapi.detectSingleFace(refImage, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    
    if (!refDetection) {
        statusDiv.innerHTML = "Lỗi hệ thống: Ảnh gốc không rõ mặt!";
        return;
    }
    const faceMatcher = new faceapi.FaceMatcher(refDetection.descriptor, 0.5); // Ngưỡng sai số 0.5

    // Bước B: Quét liên tục từ Camera
    const scanInterval = setInterval(async () => {
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
        
        if (detection) {
            const match = faceMatcher.findBestMatch(detection.descriptor);
            
            if (match.label !== "unknown") {
                clearInterval(scanInterval); // Dừng quét
                video.pause(); // Dừng camera
                
                statusDiv.style.color = "green";
                statusDiv.innerHTML = "✅ ĐIỂM DANH THÀNH CÔNG! Đã gửi dữ liệu lên Server.";
                
                // Ở ĐÂY LÀ CHỖ BẠN VIẾT CODE GỬI JWT TOKEN LÊN FIREBASE
                // ... (như bài trước) ...
            } else {
                statusDiv.innerHTML = "❌ Khuôn mặt không khớp với hồ sơ!";
            }
        } else {
            statusDiv.innerHTML = "Chưa tìm thấy khuôn mặt trong khung hình...";
        }
    }, 1000); // Mỗi 1 giây quét 1 lần để đỡ nóng máy
});