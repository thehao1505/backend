# 3_create_interactions.py
import random
from config_and_utils import (
    like_post, 
    load_from_json
)

# --- Cấu hình cho file này ---
MAX_LIKES_PER_USER = 15
USERS_FILE = "users.json"
POSTS_FILE = "posts.json"

def main():
    print("\n--- Bắt đầu tạo lượt thích (interactions) ---")

    # 1. Tải dữ liệu users và posts
    users = load_from_json(USERS_FILE)
    all_posts = load_from_json(POSTS_FILE)

    if not users or not all_posts:
        print(f"❌ Không tìm thấy file {USERS_FILE} hoặc {POSTS_FILE}.")
        print("Bạn cần chạy '1_create_users.py' và '2_create_posts.py' trước.")
        return

    print(f"   Đã tải {len(users)} users và {len(all_posts)} posts.")
    
    # 2. Mỗi user đi thích bài đăng của người khác
    for user in users:
        num_likes_to_do = random.randint(0, MAX_LIKES_PER_USER)
        
        # Lọc ra các bài không phải của user này
        posts_to_like = [p for p in all_posts if p['author_id'] != user['id']]
        
        if not posts_to_like or num_likes_to_do == 0:
            print(f"   👤 User {user['username']} không thích bài nào.")
            continue

        print(f"   👤 User {user['username']} sẽ thích {num_likes_to_do} bài đăng:")
        
        # Chọn ngẫu nhiên các bài để thích (đảm bảo không lặp lại)
        liked_count = 0
        posts_sample = random.sample(posts_to_like, min(num_likes_to_do, len(posts_to_like)))
        
        for post in posts_sample:
            success = like_post(user['token'], post['id'])
            if success:
                liked_count += 1
        
        print(f"      -> Đã thích thành công {liked_count} bài.")

    print("\n--- Hoàn thành kịch bản tạo tương tác ---")

if __name__ == "__main__":
    main()