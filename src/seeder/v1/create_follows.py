# 4_create_follows_advanced.py (Bản hoàn chỉnh, dựa trên Persona)
import random
from config_and_utils import (
    follow_user, 
    load_from_json
)
from data import CONTENT_THEMES # Cần để lấy danh sách topic

# --- CẤU HÌNH NÂNG CAO ---
USERS_FILE = "generated_data.log/users.json"

# 1. Cấu hình Cấu trúc Mạng lưới (Giữ nguyên)
POWER_USER_PERCENTAGE = 0.1
REGULAR_USER_MIN_FOLLOWS = 10
REGULAR_USER_MAX_FOLLOWS = 80
POWER_USER_MIN_FOLLOWS = REGULAR_USER_MAX_FOLLOWS + 1 
POWER_USER_MAX_FOLLOWS = 500

# 2. CẤU HÌNH MỚI: Tín hiệu Persona
# 70% số lượt follow của một user sẽ dành cho người có CÙNG persona
PREF_FOLLOW_CHANCE = 0.7 
# Lấy danh sách persona hợp lệ
VALID_PERSONAS = list(set(theme['topic'] for theme in CONTENT_THEMES))
# -----------------------------

def process_user_follows(user_group, user_type, min_follows, max_follows, all_other_users):
    """Hàm chung để xử lý việc follow (ĐÃ CẬP NHẬT)"""
    total_follows_group = 0
    
    print(f"\n--- Bắt đầu xử lý {len(user_group)} {user_type} ---")
    
    for follower in user_group:
        follower_persona = follower.get('persona')
        
        # --- LOGIC MỚI: Phân loại danh sách người để follow ---
        preferred_users = [] # Cùng persona
        other_users = [] # Khác persona
        
        if follower_persona and follower_persona in VALID_PERSONAS:
            for user in all_other_users:
                if user['id'] == follower['id']:
                    continue # Bỏ qua chính mình
                if user.get('persona') == follower_persona:
                    preferred_users.append(user)
                else:
                    other_users.append(user)
        else:
            # Nếu follower là 'general' hoặc persona không hợp lệ, tất cả là 'other'
            other_users = [u for u in all_other_users if u['id'] != follower['id']]
        # ----------------------------------------------------

        # Tổng số người user này sẽ follow (Giữ nguyên)
        num_to_follow = random.randint(min_follows, max_follows)
        
        if num_to_follow == 0:
            print(f"   👤 {user_type} {follower['username']} (Persona: {follower_persona}) không follow ai.")
            continue

        # --- LOGIC MỚI: Chia số lượng follow ---
        num_preferred_follows = int(num_to_follow * PREF_FOLLOW_CHANCE)
        num_other_follows = num_to_follow - num_preferred_follows
        
        print(f"   👤 {user_type} {follower['username']} (Persona: {follower_persona}) sẽ follow {num_to_follow} người:")
        print(f"      -> {num_preferred_follows} 'Cùng gu' (Preferred), {num_other_follows} 'Ngẫu nhiên' (Other)")
        
        # Chọn từ danh sách "Cùng gu"
        users_to_follow_pref = []
        if preferred_users:
            num_to_sample_pref = min(num_preferred_follows, len(preferred_users))
            users_to_follow_pref = random.sample(preferred_users, num_to_sample_pref)

        # Chọn từ danh sách "Ngẫu nhiên"
        users_to_follow_other = []
        if other_users:
            num_to_sample_other = min(num_other_follows, len(other_users))
            users_to_follow_other = random.sample(other_users, num_to_sample_other)
            
        users_to_follow = users_to_follow_pref + users_to_follow_other
        random.shuffle(users_to_follow) # Xáo trộn 2 nhóm
        
        if not users_to_follow:
            print(f"      (Không có ai để follow)")
            continue
        # ---------------------------------------
        
        followed_count = 0
        for user_to_follow in users_to_follow:
            success = follow_user(follower['token'], user_to_follow['id'])
            if success:
                followed_count += 1
        
        print(f"      -> Đã follow thành công {followed_count} người.")
        total_follows_group += followed_count
        
    return total_follows_group

def main():
    print("\n--- Bắt đầu tạo lượt theo dõi (Bản hoàn chỉnh - Persona) ---")

    # 1. Tải dữ liệu users
    users = load_from_json(USERS_FILE)

    if not users or len(users) < 10: 
        print(f"❌ Không tìm thấy file {USERS_FILE} hoặc không có đủ user (cần ít nhất 10).")
        return

    # Kiểm tra xem user đã có persona chưa
    if 'persona' not in users[0]:
        print(f"❌ LỖI: File {USERS_FILE} của bạn chưa có trường 'persona'.")
        print("Vui lòng chạy lại '1_create_users.py' (bản mới) trước.")
        return

    print(f"   Đã tải {len(users)} users (với personas).")
    
    # 2. Phân chia user (Giữ nguyên)
    random.shuffle(users) 
    num_power_users = int(len(users) * POWER_USER_PERCENTAGE)
    if num_power_users == 0 and len(users) > 0: 
        num_power_users = 1
        
    power_users = users[:num_power_users]
    regular_users = users[num_power_users:]
    
    print(f"   Phân chia user: {len(regular_users)} Regular Users và {len(power_users)} Power Users.")

    # 3. Xử lý "Regular Users"
    total_follows_regular = process_user_follows(
        regular_users, 
        "Regular User", 
        REGULAR_USER_MIN_FOLLOWS, 
        REGULAR_USER_MAX_FOLLOWS,
        users # Truyền toàn bộ user list
    )
    
    # 4. Xử lý "Power Users"
    total_follows_power = process_user_follows(
        power_users, 
        "Power User", 
        POWER_USER_MIN_FOLLOWS, 
        POWER_USER_MAX_FOLLOWS,
        users # Truyền toàn bộ user list
    )

    # 5. Tổng kết
    total_follows = total_follows_regular + total_follows_power
    print("\n--- Hoàn thành (Bản hoàn chỉnh) ---")
    print(f"   Regular Users đã tạo: {total_follows_regular} lượt follows")
    print(f"   Power Users đã tạo:   {total_follows_power} lượt follows")
    print(f"   Tổng cộng:            {total_follows} lượt follows đã được tạo")

if __name__ == "__main__":
    main()