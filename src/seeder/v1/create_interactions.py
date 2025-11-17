# 3_create_interactions.py (Đã viết lại)
# Mô phỏng tương tác CÓ MẪU HÌNH (dựa trên persona)
import random
from config_and_utils import (
    like_post, 
    log_post_view,
    log_post_click,
    log_post_share,
    load_from_json
)
from data import CONTENT_THEMES # Cần để lấy danh sách topic

# --- Cấu hình cho file này ---
USERS_FILE = "generated_data.log/users.json"
POSTS_FILE = "generated_data.log/posts.json"

# --- Cấu hình Xác suất ---
# User 'general' sẽ tương tác ngẫu nhiên (nhưng không quá nhiều)
PROB_GENERAL = 0.2    # 20% cơ hội tương tác nếu là user "general"

# User 'persona' (ví dụ: technology)
PROB_PREFERRED = 0.8  # 80% cơ hội tương tác nếu "đúng gu" (persona == topic)
PROB_OTHER = 0.05     # 5% cơ hội tương tác nếu "không đúng gu"

# Ngưỡng (tính bằng mili-giây)
DWELL_TIME_THRESHOLD = 10000  # 10 giây
DWELL_TIME_PREFERRED_MIN = 15000 # 15 giây (thời gian xem tối thiểu nếu "đúng gu")
DWELL_TIME_MAX = 60000        # 60 giây

def main():
    print("\n--- Bắt đầu tạo tất cả tương tác (Dựa trên Persona) ---")

    # 1. Tải dữ liệu
    users = load_from_json(USERS_FILE)
    all_posts = load_from_json(POSTS_FILE)

    if not users or not all_posts:
        print(f"❌ Không tìm thấy file {USERS_FILE} hoặc {POSTS_FILE}.")
        print("Bạn cần chạy '1_create_users.py' và '2_create_posts.py' (bản mới) trước.")
        return

    # Kiểm tra xem user đã có persona chưa
    if 'persona' not in users[0]:
        print(f"❌ LỖI: File {USERS_FILE} của bạn chưa có trường 'persona'.")
        print("Vui lòng chạy lại '1_create_users.py' (bản mới) trước.")
        return
        
    # Kiểm tra xem post đã có topic chưa
    if 'topic' not in all_posts[0]:
        print(f"❌ LỖI: File {POSTS_FILE} của bạn chưa có trường 'topic'.")
        print("Vui lòng chạy lại '2_create_posts.py' (bản mới) trước.")
        return

    print(f"   Đã tải {len(users)} users (với personas) và {len(all_posts)} posts (với topics).")
    
    total_views = 0
    total_clicks = 0
    total_likes = 0
    total_shares = 0
    
    # 2. Mỗi user đi tương tác với các bài đăng
    for user in users:
        user_persona = user.get('persona', 'general') # Lấy persona
        print(f"\n   👤 Xử lý User {user['username']} (Persona: {user_persona})")

        # Lọc các bài không phải của user này
        other_posts = [p for p in all_posts if p['author_id'] != user['id']]
        
        if not other_posts:
            print(f"   (Không có bài của người khác để tương tác.)")
            continue

        # --- LOGIC MỚI: Không dùng random.sample ---
        # Chúng ta duyệt qua TẤT CẢ các bài đăng khác và để "persona" quyết định
        for post in other_posts:
            post_topic = post.get('topic')
            
            # 1. Quyết định xác suất tương tác
            prob = 0
            if user_persona == 'general':
                prob = PROB_GENERAL # User này tương tác ngẫu nhiên
            elif user_persona == post_topic:
                prob = PROB_PREFERRED # "Đúng gu"
            else:
                prob = PROB_OTHER # "Không đúng gu"
            
            # 2. Quyết định có tương tác hay không
            if random.random() > prob:
                continue # Bỏ qua, không tương tác với post này

            # 3. NẾU TƯƠNG TÁC (Đã vượt qua bộ lọc xác suất)
            print(f"   ... Tương tác với post {post['id']} (Topic: {post_topic}, Prob: {prob*100}%)")

            # --- 3a. Tạo Dwell Time (Thời gian xem) ---
            dwell_time_ms = random.randint(1000, DWELL_TIME_MAX)
            # Nếu "đúng gu", đảm bảo thời gian xem phải vượt ngưỡng
            if prob == PROB_PREFERRED and dwell_time_ms < DWELL_TIME_PREFERRED_MIN:
                dwell_time_ms = random.randint(DWELL_TIME_PREFERRED_MIN, DWELL_TIME_MAX)

            log_post_view(user['token'], post['id'], dwell_time_ms)
            total_views += 1
            
            # --- 3b. Quyết định Clicks, Likes, Shares (Dựa trên dwell time) ---
            if dwell_time_ms > DWELL_TIME_THRESHOLD:
                # Nếu xem lâu, chắc chắn sẽ click
                log_post_click(user['token'], post['id'])
                total_clicks += 1
                
                # Nếu "đúng gu", 50% cơ hội like
                if prob == PROB_PREFERRED and random.random() < 0.5:
                    if like_post(user['token'], post['id']): 
                        total_likes += 1
                
                # Nếu "đúng gu", 20% cơ hội share
                if prob == PROB_PREFERRED and random.random() < 0.2:
                    if log_post_share(user['token'], post['id']):
                        total_shares += 1

    print("\n--- Hoàn thành kịch bản tạo tương tác (Có Mẫu Hình) ---")
    print(f"Tổng cộng đã tạo:")
    print(f"  - {total_views} lượt Views")
    print(f"  - {total_clicks} lượt Clicks")
    print(f"  - {total_likes} lượt Likes")
    print(f"  - {total_shares} lượt Shares")

if __name__ == "__main__":
    main()