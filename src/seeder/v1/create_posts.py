# 2_create_posts.py (Đã hoàn chỉnh)
import random
import uuid
import copy 

# Lấy CONTENT_THEMES từ data.py
from data import CONTENT_THEMES
from config_and_utils import (
    create_post, 
    load_from_json, 
    save_to_json
)

# --- Cấu hình cho file này ---
MAX_POSTS_PER_USER = 20
USERS_FILE = "generated_data.log/users.json"
OUTPUT_FILE = "generated_data.log/posts.json"

# --- THÊM: Cấu hình Persona ---
PERSONA_POST_CHANCE = 0.8 # 80% cơ hội đăng bài "đúng gu"

# Lấy tất cả chủ đề có sẵn
ALL_AVAILABLE_TOPICS = list(set(theme['topic'] for theme in CONTENT_THEMES))

# Tạo một bản sao của danh sách gốc
available_themes = copy.deepcopy(CONTENT_THEMES)

def get_post_theme_by_persona(persona):
    """
    (Hàm trợ giúp mới)
    Quyết định chủ đề bài đăng dựa trên persona,
    và đảm bảo chỉ lấy từ các theme CÒN LẠI.
    Trả về None nếu hết theme.
    """
    global available_themes
    
    # --- Logic "Dừng nếu hết" của bạn ---
    if not available_themes:
        return None # Đã hết sạch theme
    # ------------------------------------

    # 1. (80% cơ hội) Thử đăng bài "đúng gu" (đúng persona)
    if persona in ALL_AVAILABLE_TOPICS and random.random() < PERSONA_POST_CHANCE:
        # Tìm các theme "đúng gu" VẪN CÒN LẠI
        preferred_themes = [t for t in available_themes if t['topic'] == persona]
        
        if preferred_themes:
            theme = random.choice(preferred_themes)
            available_themes.remove(theme) # Xóa để không trùng
            return theme
            
    # 2. (20% cơ hội, hoặc persona là 'general', hoặc đã hết theme "đúng gu")
    # Đăng bài ngẫu nhiên từ những gì CÒN LẠI
    theme = random.choice(available_themes)
    available_themes.remove(theme) # Xóa để không trùng
    return theme

def generate_post_data(user_persona):
    """
    Tạo dữ liệu bài đăng, CÓ TÍNH ĐẾN persona của user.
    Sẽ trả về None nếu hết mục để dùng.
    """
    
    # --- THAY ĐỔI CHÍNH ---
    # Lấy theme dựa trên persona và logic "còn hàng"
    theme = get_post_theme_by_persona(user_persona)
    
    # Nếu hàm trên trả về None (vì hết theme), chúng ta trả về None
    if theme is None:
        return None 
    # --- KẾT THÚC THAY ĐỔI ---

    # Tạo ID duy nhất (giữ nguyên)
    content = f"{theme['content']}"
    
    return {
        "content": content,
        "images": [],
        "topic": theme['topic'], # Trả về topic để lưu
    }

def main():
    print("\n--- Bắt đầu tạo bài đăng (Dựa trên Persona) ---")
    
    # 1. Tải danh sách người dùng (đã có 'persona')
    users = load_from_json(USERS_FILE)
    if not users:
        print(f"❌ Không tìm thấy file {USERS_FILE}. Bạn cần chạy '1_create_users.py' trước.")
        return

    total_possible_posts = len(users) * MAX_POSTS_PER_USER
    total_unique_themes = len(CONTENT_THEMES)
    
    print(f"   Đã tải {len(users)} người dùng. Sẽ tạo tối đa {total_possible_posts} bài đăng.")
    print(f"   (Kho nội dung có {total_unique_themes} mẫu duy nhất)")
    
    if total_possible_posts > total_unique_themes:
        print(f"   ⚠️  Lưu ý: Bạn dự định tạo tối đa ({total_possible_posts}) bài đăng, nhưng chỉ có ({total_unique_themes}) mẫu.")
        print(f"   Script sẽ DỪNG LẠI sau khi dùng hết {total_unique_themes} mẫu.")

    all_created_posts = []
    
    # Cờ (flag) để dừng cả 2 vòng lặp (Giữ nguyên logic của bạn)
    themes_exhausted = False 

    # 2. Tạo bài đăng cho mỗi người dùng
    for user in users:
        # --- THAY ĐỔI: Lấy persona của user ---
        user_persona = user.get('persona', 'general') # Mặc định là 'general'
        # -----------------------------------
        
        num_posts = random.randint(1, MAX_POSTS_PER_USER)
        print(f"   👤 User {user['username']} (Persona: {user_persona}) sẽ tạo {num_posts} bài đăng:")
        
        for _ in range(num_posts):
            # --- THAY ĐỔI: Truyền persona vào hàm tạo ---
            post_data = generate_post_data(user_persona)
            
            # Kiểm tra xem đã hết bài đăng chưa (Giữ nguyên logic của bạn)
            if post_data is None:
                print("   ⚠️  Đã dùng hết tất cả nội dung mẫu. Dừng tạo bài đăng.")
                themes_exhausted = True 
                break 

            created_post = create_post(user['token'], post_data)
            
            if created_post and '_id' in created_post:
                # Lưu 'topic' (Giữ nguyên logic của bạn)
                all_created_posts.append({
                    "id": created_post['_id'],
                    "author_id": user['id'],
                    "topic": post_data['topic']
                })
        
        if themes_exhausted:
            # Dừng luôn vòng lặp duyệt USER (Giữ nguyên logic của bạn)
            break 
    
    if not all_created_posts:
        print("\n❌ Không tạo được bài đăng nào. Dừng script.")
        return

    # 3. Lưu danh sách bài đăng vào file
    save_to_json(OUTPUT_FILE, all_created_posts)
    print(f"\n--- Hoàn thành: Đã tạo và lưu {len(all_created_posts)} posts vào {OUTPUT_FILE} ---")

if __name__ == "__main__":
    main()