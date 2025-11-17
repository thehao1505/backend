# 6_update_categories.py
# Script này đọc file posts.json và dùng 'topic' để cập nhật 'categories'
import time
from config_and_utils import (
    update_post,
    load_from_json
)

# --- Cấu hình ---
USERS_FILE = "generated_data.log/users.json"
POSTS_FILE = "generated_data.log/posts.json"

def main():
    print("\n--- Bắt đầu cập nhật 'categories' cho bài đăng ---")

    # 1. Tải dữ liệu users và posts
    users = load_from_json(USERS_FILE)
    all_posts = load_from_json(POSTS_FILE)

    if not users or not all_posts:
        print(f"❌ Không tìm thấy file {USERS_FILE} hoặc {POSTS_FILE}.")
        return

    # 2. Tạo một "map" (bộ tra cứu) để lấy token nhanh
    # Điều này hiệu quả hơn là lặp 2 vòng (nested loop)
    token_map = {user['id']: user['token'] for user in users}

    print(f"   Đã tải {len(users)} users và {len(all_posts)} posts.")
    
    updated_count = 0
    failed_count = 0
    
    # 3. Lặp qua từng bài đăng để cập nhật
    for post in all_posts:
        post_id = post.get('id')
        author_id = post.get('author_id')
        topic = post.get('topic') #

        if not post_id or not author_id or not topic:
            print(f"   ⚠️  Bỏ qua bài đăng (thiếu id, author_id, hoặc topic): {post}")
            continue
            
        # Tìm token của tác giả
        author_token = token_map.get(author_id)
        
        if not author_token:
            print(f"   ⚠️  Không tìm thấy token cho author_id {author_id} (Post: {post_id})")
            failed_count += 1
            continue
            
        # 4. Tạo payload và gọi API
        # Dựa trên curl: {"categories": ["gaming"]}
        # Dựa trên data: "topic": "gaming"
        payload = {
            "categories": [topic] 
        }
        
        print(f"   👤 Đang cập nhật post {post_id} (Topic: {topic})...")
        success = update_post(author_token, post_id, payload)
        
        if success:
            updated_count += 1
        else:
            failed_count += 1
        
        # Tạm dừng một chút để tránh làm quá tải API (nếu cần)
        # time.sleep(0.05) 

    print("\n--- Hoàn thành cập nhật categories ---")
    print(f"   Thành công: {updated_count} bài đăng")
    print(f"   Thất bại:   {failed_count} bài đăng")

if __name__ == "__main__":
    main()