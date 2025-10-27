# config_and_utils.py
import requests
import string
import random
import json
import os

# --- Cấu hình API ---
BASE_URL = "http://localhost:12345/api/v1" 

# --- Tiện ích tạo dữ liệu ---
def generate_random_string(length=10):
    """Tạo chuỗi ngẫu nhiên gồm chữ cái và số."""
    characters = string.ascii_lowercase + string.digits
    return ''.join(random.choice(characters) for i in range(length))

# --- Tiện ích API ---
def handle_api_error(error, action_message=""):
    """Xử lý lỗi request và in ra response body nếu có."""
    print(f"❌ Lỗi {action_message}: {error}")
    if hasattr(error, 'response') and error.response is not None:
        try:
            print(f"   Response body: {error.response.json()}")
        except json.JSONDecodeError:
            print(f"   Response body: {error.response.text}")

def register_user(user_data):
    """Đăng ký người dùng mới."""
    url = f"{BASE_URL}/auth/register"
    try:
        response = requests.post(url, json=user_data)
        response.raise_for_status() 
        print(f"✅ Đăng ký thành công: {user_data['username']} ({user_data['firstName']} {user_data['lastName']})")
        return response.json()
    except requests.exceptions.RequestException as e:
        handle_api_error(e, f"đăng ký user {user_data['username']}")
        return None

def login_user(username, password):
    """Đăng nhập người dùng để lấy token."""
    url = f"{BASE_URL}/auth/login"
    try:
        response = requests.post(url, json={"username": username, "password": password})
        response.raise_for_status()
        data = response.json()
        print(f"   ✅ Đăng nhập thành công: {username}")
        return data.get('token', {}).get('accessToken')
    except requests.exceptions.RequestException as e:
        handle_api_error(e, f"đăng nhập user {username}")
        return None

def create_post(token, post_data):
    """Tạo bài đăng mới."""
    url = f"{BASE_URL}/posts"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.post(url, json=post_data, headers=headers)
        response.raise_for_status()
        post_info = response.json()
        print(f"   ✅ Tạo post thành công: ID {post_info.get('_id')} - Nội dung: {post_data['content'][:30]}...")
        return post_info
    except requests.exceptions.RequestException as e:
        handle_api_error(e, "tạo post")
        return None

def like_post(token, post_id):
    """Thích một bài đăng."""
    url = f"{BASE_URL}/posts/{post_id}/like"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.post(url, headers=headers)
        response.raise_for_status()
        if response.status_code == 201 or response.status_code == 200:
            print(f"      ✅ Thích post {post_id} thành công.")
            return True
        else:
            print(f"      ❓ Thích post {post_id} trả về status {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        handle_api_error(e, f"thích post {post_id}")
        return False

# --- Tiện ích đọc/ghi file ---
def save_to_json(filename, data):
    """Lưu dữ liệu (list/dict) vào file JSON."""
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"💾 Dữ liệu đã được lưu vào file: {filename}")
    except IOError as e:
        print(f"❌ Lỗi khi lưu file {filename}: {e}")

def load_from_json(filename):
    """Đọc dữ liệu từ file JSON."""
    if not os.path.exists(filename):
        print(f"⚠️ Không tìm thấy file {filename}. Bỏ qua.")
        return None
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"💾 Đã tải dữ liệu từ file: {filename}")
        return data
    except (IOError, json.JSONDecodeError) as e:
        print(f"❌ Lỗi khi đọc file {filename}: {e}")
        return None

def follow_user(token, user_id_to_follow):
    """Follow một người dùng khác."""
    url = f"{BASE_URL}/users/{user_id_to_follow}/follow"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.post(url, headers=headers)
        response.raise_for_status()
        if response.status_code == 201 or response.status_code == 200:
            print(f"      ✅ Follow user {user_id_to_follow} thành công.")
            return True
        else:
            print(f"      ❓ Follow user {user_id_to_follow} trả về status {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        # Lỗi 400 có thể xảy ra nếu user đã follow rồi, chúng ta có thể bỏ qua
        if hasattr(e, 'response') and e.response is not None and e.response.status_code == 400:
             print(f"      INFO: Không thể follow {user_id_to_follow} (Có thể đã follow rồi).")
             return False
        
        handle_api_error(e, f"follow user {user_id_to_follow}")
        return False