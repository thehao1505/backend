# 2_create_posts.py
import random
from data import CONTENT_THEMES
from config_and_utils import (
    create_post, 
    load_from_json, 
    save_to_json
)

# --- Cấu hình cho file này ---
MAX_POSTS_PER_USER = 8
USERS_FILE = "users.json"
OUTPUT_FILE = "posts.json"

def generate_post_data():
    """Tạo dữ liệu bài đăng ngẫu nhiên theo chủ đề."""
    theme = random.choice(CONTENT_THEMES)
    random_suffix = f"(Ref: {random.randint(1000, 9999)})"
    content = f"{theme['content']} {random_suffix}"
    
    return {
        "content": content,
        "images": [],
        # "tags": [theme['topic']] # Bỏ comment nếu API hỗ trợ
    }

def main():
    print("\n--- Bắt đầu tạo bài đăng ---")
    
    # 1. Tải danh sách người dùng
    users = load_from_json(USERS_FILE)
    if not users:
        print(f"❌ Không tìm thấy file {USERS_FILE}. Bạn cần chạy '1_create_users.py' trước.")
        return

    print(f"   Đã tải {len(users)} người dùng từ {USERS_FILE}.")
    all_created_posts = []

    # 2. Tạo bài đăng cho mỗi người dùng
    for user in users:
        num_posts = random.randint(1, MAX_POSTS_PER_USER)
        print(f"   👤 User {user['username']} sẽ tạo {num_posts} bài đăng:")
        
        for _ in range(num_posts):
            post_data = generate_post_data()
            created_post = create_post(user['token'], post_data)
            
            if created_post and '_id' in created_post:
                all_created_posts.append({
                    "id": created_post['_id'],
                    "author_id": user['id']
                })
    
    if not all_created_posts:
        print("\n❌ Không tạo được bài đăng nào. Dừng script.")
        return

    # 3. Lưu danh sách bài đăng vào file
    save_to_json(OUTPUT_FILE, all_created_posts)
    print(f"\n--- Hoàn thành: Đã tạo và lưu {len(all_created_posts)} posts vào {OUTPUT_FILE} ---")

if __name__ == "__main__":
    main()