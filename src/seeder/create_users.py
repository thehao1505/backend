# 1_create_users.py
import random
from data import FIRST_NAMES, LAST_NAMES
from config_and_utils import (
    generate_random_string, 
    register_user, 
    login_user, 
    save_to_json
)

# --- Cấu hình cho file này ---
NUM_USERS_TO_CREATE = 200
OUTPUT_FILE = "users.json"

def generate_user_data():
    """Tạo dữ liệu người dùng ngẫu nhiên có nghĩa."""
    password = "password"
    first_name = random.choice(FIRST_NAMES)
    last_name = random.choice(LAST_NAMES)
    username = f"{first_name.lower()}.{last_name.lower()}"
    email = f"{username}@example.com"
    return {
        "username": username,
        "email": email,
        "password": password,
        "firstName": first_name,
        "lastName": last_name
    }

def main():
    print(f"\n--- Bắt đầu tạo {NUM_USERS_TO_CREATE} người dùng ---")
    created_users = []
    
    for i in range(NUM_USERS_TO_CREATE):
        print(f"\n--- Tạo user {i+1}/{NUM_USERS_TO_CREATE} ---")
        user_data = generate_user_data()
        reg_result = register_user(user_data)
        
        if reg_result and 'user' in reg_result and '_id' in reg_result['user']:
            user_id = reg_result['user']['_id']
            token = reg_result.get('token', {}).get('accessToken')
            
            # Đăng nhập lại nếu API đăng ký không trả token
            if not token:
                print(f"   ... Đang đăng nhập lại để lấy token cho {user_data['username']}")
                token = login_user(user_data['username'], user_data['password'])

            if token:
                created_users.append({
                    "id": user_id,
                    "username": user_data['username'],
                    "password": user_data['password'],
                    "token": token
                })
            else:
                print(f"   ⚠️ Không lấy được token cho user {user_data['username']}, bỏ qua.")
        else:
            print(f"   ⚠️ Đăng ký user {user_data['username']} thất bại.")

    if not created_users:
        print("\n❌ Không tạo được người dùng nào. Dừng script.")
        return

    # Lưu danh sách user đã tạo vào file
    save_to_json(OUTPUT_FILE, created_users)
    print(f"\n--- Hoàn thành: Đã tạo và lưu {len(created_users)} users vào {OUTPUT_FILE} ---")

if __name__ == "__main__":
    main()