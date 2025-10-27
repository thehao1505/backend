# 4_create_follows.py
import random
from config_and_utils import (
    follow_user, 
    load_from_json
)

# --- Cấu hình cho file này ---
MAX_FOLLOWS_PER_USER = 5  # Mỗi user sẽ follow tối đa 5 người khác
USERS_FILE = "users.json"

def main():
    print("\n--- Bắt đầu tạo lượt theo dõi (follows) ---")

    # 1. Tải dữ liệu users
    users = load_from_json(USERS_FILE)

    if not users or len(users) < 2:
        print(f"❌ Không tìm thấy file {USERS_FILE} hoặc không có đủ (ít nhất 2) user.")
        print("Bạn cần chạy '1_create_users.py' trước.")
        return

    print(f"   Đã tải {len(users)} users.")
    total_follows = 0
    
    # 2. Mỗi user đi follow các user khác
    for follower in users:
        # Số lượng người mà user này sẽ follow
        num_to_follow = random.randint(0, MAX_FOLLOWS_PER_USER)
        
        # Lọc ra danh sách những người "có thể follow" (không phải chính mình)
        other_users = [u for u in users if u['id'] != follower['id']]
        
        if not other_users or num_to_follow == 0:
            print(f"   👤 User {follower['username']} không follow ai.")
            continue

        print(f"   👤 User {follower['username']} sẽ follow {num_to_follow} người:")
        
        # Chọn ngẫu nhiên các user để follow
        followed_count = 0
        users_to_follow = random.sample(other_users, min(num_to_follow, len(other_users)))
        
        for user_to_follow in users_to_follow:
            success = follow_user(follower['token'], user_to_follow['id'])
            if success:
                followed_count += 1
        
        print(f"      -> Đã follow thành công {followed_count} người.")
        total_follows += followed_count

    print(f"\n--- Hoàn thành: Tổng cộng có {total_follows} lượt follow đã được tạo ---")

if __name__ == "__main__":
    main()