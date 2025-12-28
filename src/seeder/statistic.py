import pandas as pd
import matplotlib.pyplot as plt

# --- CẤU HÌNH ĐƯỜNG DẪN FILE ---
FILE_PATH = './data_offline_eval/test_interactions.csv' # Thay đường dẫn file của bạn vào đây

try:
    # 1. Đọc file CSV
    df = pd.read_csv(FILE_PATH)
    
    # Kiểm tra xem có cột userId không
    if 'userId' not in df.columns:
        print("❌ Lỗi: Không tìm thấy cột 'userId' trong file CSV.")
    else:
        # 2. Đếm số lần xuất hiện của mỗi userId
        # value_counts() sẽ đếm và tự động sắp xếp giảm dần
        user_counts = df['userId'].value_counts().reset_index()
        user_counts.columns = ['userId', 'interaction_count']

        print(f"\n=== TỔNG QUAN ===")
        print(f"Tổng số dòng (interactions): {len(df)}")
        print(f"Tổng số user (unique): {len(user_counts)}")
        print(f"Trung bình interaction/user: {user_counts['interaction_count'].mean():.2f}")
        print(f"User tương tác nhiều nhất: {user_counts['interaction_count'].max()}")
        print(f"User tương tác ít nhất: {user_counts['interaction_count'].min()}")

        # 3. Phân loại theo Size (Small, Medium, Large) như bạn đã phân tích trước đó
        small = user_counts[user_counts['interaction_count'] <= 2]
        medium = user_counts[(user_counts['interaction_count'] >= 3) & (user_counts['interaction_count'] <= 5)]
        large = user_counts[user_counts['interaction_count'] > 5]

        print(f"\n=== PHÂN BỐ GROUND TRUTH SIZE ===")
        print(f"Small (1-2):  {len(small)} users ({len(small)/len(user_counts)*100:.2f}%)")
        print(f"Medium (3-5): {len(medium)} users ({len(medium)/len(user_counts)*100:.2f}%)")
        print(f"Large (>5):   {len(large)} users ({len(large)/len(user_counts)*100:.2f}%)")

        print(f"\n=== TOP 10 USER TƯƠNG TÁC NHIỀU NHẤT ===")
        print(user_counts.head(10))

        # 4. Xuất ra file CSV kết quả nếu muốn
        output_file = 'user_interaction_counts.csv'
        user_counts.to_csv(output_file, index=False)
        print(f"\n✅ Đã lưu danh sách chi tiết vào file: {output_file}")

except FileNotFoundError:
    print(f"❌ Không tìm thấy file: {FILE_PATH}")
except Exception as e:
    print(f"❌ Có lỗi xảy ra: {e}")