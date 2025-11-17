# scripts/predict.py
import csv
import json
import os
import requests  # Cần cài: pip install requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

# --- CẤU HÌNH ---
API_BASE_URL = 'http://localhost:3000'  # Đảm bảo server NestJS của bạn đang chạy
RECOMMENDATION_ENDPOINT = '/recommendation/cbf'  # Hoặc '/recommendation/hybrid'
K = 20  # Số lượng item muốn đề xuất cho mỗi user
DATA_PATH = os.path.join(os.path.dirname(__file__), '../data_synthetic')
GROUND_TRUTH_FILE = os.path.join(DATA_PATH, 'test_interactions.csv')
OUTPUT_FILE = os.path.join(DATA_PATH, 'predictions.json')
MAX_WORKERS = 10  # Số lượng luồng để gọi API song song
# --- KẾT THÚC CẤU HÌNH ---

def get_test_user_ids():
    """
    Đọc file test_interactions.csv và lấy ra danh sách user ID duy nhất cần test.
    """
    user_ids = set()
    try:
        with open(GROUND_TRUTH_FILE, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                user_ids.add(row['userId'])
    except FileNotFoundError:
        print(f"[Predict] Lỗi: Không tìm thấy file {GROUND_TRUTH_FILE}")
        return []
        
    print(f"[Predict] Đã tìm thấy {len(user_ids)} user duy nhất trong file test.")
    return list(user_ids)

def fetch_recommendations(session, user_id):
    """
    Gọi API recommendation cho một user cụ thể.
    """
    try:
        url = f"{API_BASE_URL}{RECOMMENDATION_ENDPOINT}/{user_id}?page=1&limit={K}"
        response = session.get(url, timeout=10)

        if not response.ok:
            # print(f"[Predict] Lỗi khi gọi API cho user {user_id}: {response.status_text}")
            return user_id, []

        data = response.json()
        item_ids = [item['_id'] for item in data.get('items', [])]
        return user_id, item_ids
    except requests.RequestException as e:
        # print(f"[Predict] Lỗi nghiêm trọng khi gọi user {user_id}: {e}")
        return user_id, []

def run_prediction():
    """
    Hàm chạy chính
    """
    print('[Predict] Bắt đầu quá trình lấy dự đoán...')
    user_ids = get_test_user_ids()
    if not user_ids:
        return
        
    all_predictions = {}
    
    # Sử dụng ThreadPoolExecutor và session để tăng tốc độ gọi API
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        with requests.Session() as session:
            # Tạo các task
            futures = [executor.submit(fetch_recommendations, session, user_id) for user_id in user_ids]
            
            # Thu thập kết quả khi hoàn thành
            progress = tqdm(as_completed(futures), total=len(user_ids), desc="[Predict] Đang gọi API")
            for future in progress:
                user_id, recommended_post_ids = future.result()
                all_predictions[user_id] = recommended_post_ids

    # Lưu kết quả
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(all_predictions, f, indent=2)
        print(f"[Predict] --- HOÀN TẤT! ---")
        print(f"Đã lưu {len(all_predictions)} dự đoán vào file: {OUTPUT_FILE}")
    except IOError as e:
        print(f"[Predict] Lỗi khi ghi file: {e}")

if __name__ == "__main__":
    run_prediction()