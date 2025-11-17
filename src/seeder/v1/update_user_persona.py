# 7_update_personas.py
# Script này đọc file users.json và dùng 'persona' để cập nhật
import time
from config_and_utils import (
    update_user,
    load_from_json
)

# --- Cấu hình ---
USERS_FILE = "generated_data.log/users.json"

def main():
    print("\n--- Bắt đầu cập nhật 'persona' cho user ---")

    # 1. Tải dữ liệu users
    users = load_from_json(USERS_FILE)

    if not users:
        print(f"❌ Không tìm thấy file {USERS_FILE}.")
        return

    print(f"   Đã tải {len(users)} users.")
    
    updated_count = 0
    failed_count = 0
    
    # 2. Lặp qua từng user để cập nhật
    for user in users:
        user_id = user.get('id')
        token = user.get('token')
        persona = user.get('persona') #

        if not user_id or not token or not persona:
            print(f"   ⚠️  Bỏ qua user (thiếu id, token, hoặc persona): {user.get('username')}")
            continue
            
        # 3. Tạo payload và gọi API
        # Dựa trên curl: {"persona": ["gaming"]}
        # Dựa trên data: "persona": "gaming"
        # Chúng ta cần chuyển đổi string thành array
        payload = {
            "persona": [persona] 
        }
        
        print(f"   👤 Đang cập nhật user {user_id} (Persona: {persona})...")
        # Gọi API với token CỦA CHÍNH USER ĐÓ
        success = update_user(token, user_id, payload)
        
        if success:
            updated_count += 1
        else:
            failed_count += 1
        
        # Tạm dừng một chút để tránh làm quá tải API (nếu cần)
        # time.sleep(0.05) 

    print("\n--- Hoàn thành cập nhật persona ---")
    print(f"   Thành công: {updated_count} user")
    print(f"   Thất bại:   {failed_count} user")

if __name__ == "__main__":
    main()