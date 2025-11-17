# scripts/evaluate.py
import csv
import json
import os
from collections import defaultdict

# --- CẤU HÌNH ---
K_VALUES = [5, 10, 20]  # Tính toán metrics tại các top K này
DATA_PATH = os.path.join(os.path.dirname(__file__), '../data_synthetic')
GROUND_TRUTH_FILE = os.path.join(DATA_PATH, 'test_interactions.csv')
PREDICTIONS_FILE = os.path.join(DATA_PATH, 'predictions.json')
# --- KẾT THÚC CẤU HÌNH ---

def load_ground_truth():
    """
    Đọc file test_interactions.csv và tạo Map "đáp án".
    Trả về: defaultdict(set)
    """
    ground_truth = defaultdict(set)
    try:
        with open(GROUND_TRUTH_FILE, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                ground_truth[row['userId']].add(row['postId'])
        print(f"[Evaluate] Đã tải {len(ground_truth)} user 'đáp án' (ground truth).")
        return ground_truth
    except FileNotFoundError:
        print(f"[Evaluate] Lỗi: Không tìm thấy file {GROUND_TRUTH_FILE}")
        return None

def load_predictions():
    """
    Đọc file predictions.json.
    Trả về: dict
    """
    try:
        with open(PREDICTIONS_FILE, 'r', encoding='utf-8') as f:
            predictions = json.load(f)
        print(f"[Evaluate] Đã tải {len(predictions)} user 'dự đoán'.")
        return predictions
    except FileNotFoundError:
        print(f"[Evaluate] Lỗi: Không tìm thấy file {PREDICTIONS_FILE}")
        return None
    except json.JSONDecodeError:
        print(f"[Evaluate] Lỗi: File predictions.json bị lỗi hoặc không đúng định dạng.")
        return None

def calculate_metrics(ground_truth, predictions):
    """
    Tính toán các chỉ số Precision@K, Recall@K, và MAP@K.
    """
    final_metrics = {}
    
    for K in K_VALUES:
        total_precision = 0
        total_recall = 0
        total_apk = 0
        user_count = 0

        for user_id, predicted_items in predictions.items():
            if user_id in ground_truth:
                actual_items = ground_truth[user_id]
                if not actual_items:  # Bỏ qua user không có "đáp án"
                    continue

                # Chỉ lấy top K
                predicted_at_k = predicted_items[:K]
                if not predicted_at_k: # Bỏ qua nếu không có dự đoán
                    continue
                    
                user_count += 1
                hits = 0
                apk_sum = 0  # Dùng để tính Average Precision (APK)

                for i, item in enumerate(predicted_at_k):
                    if item in actual_items:
                        hits += 1
                        apk_sum += hits / (i + 1)  # Precision tại vị trí này

                precision = hits / K
                recall = hits / len(actual_items)
                
                # Nen mau so cua APK la min(K, len(actual_items))
                apk = (apk_sum / min(K, len(actual_items))) if apk_sum > 0 else 0

                total_precision += precision
                total_recall += recall
                total_apk += apk

        if user_count > 0:
            final_metrics[f"@{K}"] = {
                'Precision@K': total_precision / user_count,
                'Recall@K': total_recall / user_count,
                'MAP@K': total_apk / user_count,  # Mean Average Precision
            }
        else:
            print(f"[Evaluate] Không có user nào để đánh giá cho K={K}")

    return final_metrics, user_count

def run_evaluation():
    """
    Hàm chạy chính
    """
    print('[Evaluate] Bắt đầu quá trình đánh giá...')
    ground_truth = load_ground_truth()
    predictions = load_predictions()

    if ground_truth is None or predictions is None:
        print("[Evaluate] Dừng lại do không tải được file.")
        return

    metrics, user_count = calculate_metrics(ground_truth, predictions)

    print(f"\n[Evaluate] --- KẾT QUẢ ĐÁNH GIÁ (trên {user_count} users) ---")
    
    # In bảng kết quả
    if metrics:
        print(f"{'Metric':<8} | {'Precision@K':<15} | {'Recall@K':<15} | {'MAP@K':<15}")
        print("-" * 58)
        for k_val, m in metrics.items():
            print(f"{k_val:<8} | {m['Precision@K']:<15.4f} | {m['Recall@K']:<15.4f} | {m['MAP@K']:<15.4f}")
    else:
        print("Không có kết quả metrics để hiển thị.")


if __name__ == "__main__":
    run_evaluation()