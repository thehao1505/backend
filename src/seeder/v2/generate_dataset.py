import pandas as pd
import numpy as np
import random
import uuid
import os
from tqdm import tqdm
from collections import defaultdict
import datetime

# --- 1. CẤU HÌNH ---
N_USERS = 5000
N_POSTS = 20000
LATENT_DIMS = 32 # Số chiều "sở thích" (gu)
DATA_PATH = './data_synthetic' # Thư mục để lưu CSV

# Cấu hình mô phỏng
AVG_INTERACTIONS_PER_USER = 15 # Số tương tác "chất lượng cao" trung bình
POPULARITY_EFFECT = 0.3 # Ảnh hưởng của độ phổ biến
NOISE_LEVEL = 0.1 # Độ nhiễu ngẫu nhiên

SYNTHETIC_SEARCH_TERMS = [
    "lập trình nestjs", "hướng dẫn react", "đánh giá gpt-4", "công thức nấu ăn",
    "du lịch đà lạt", "crypto hôm nay", "phim chiếu rạp", "tin tức a.i",
    "học machine learning", "so sánh s23 ultra", "chăm sóc da"
]

print(f"Bắt đầu tạo dữ liệu: {N_USERS} users, {N_POSTS} posts...")

# --- 2. TẠO THƯ MỤC ---
os.makedirs(DATA_PATH, exist_ok=True)

# --- 3. CÁC HÀM TẠO DỮ LIỆU ---

def generate_users():
    """Tạo file users.csv"""
    print("Bước 1: Đang tạo Users...")
    users = []
    for i in tqdm(range(N_USERS)):
        users.append({
            "id": f"{uuid.uuid4()}",
            "username": f"user_{i}",
            "firstName": f"User",
            "lastName": f"{i}",
            "shortDescription": f"Đây là bio tổng hợp của user {i}"
        })
    df = pd.DataFrame(users)
    df.to_csv(f"{DATA_PATH}/users.csv", index=False)
    print(f"Đã tạo {len(users)} users.")
    return df

def generate_posts(user_ids):
    """Tạo file posts.csv"""
    print("Bước 2: Đang tạo Posts...")
    posts = []
    
    # Tạo ngày ngẫu nhiên trong 1 năm qua
    start_date = datetime.datetime.now() - datetime.timedelta(days=365)
    
    for i in tqdm(range(N_POSTS)):
        random_days = random.randint(0, 364)
        random_seconds = random.randint(0, 86399)
        created_at = start_date + datetime.timedelta(days=random_days, seconds=random_seconds)
        
        posts.append({
            "id": f"{uuid.uuid4()}",
            "authorId": random.choice(user_ids),
            "content": f"Nội dung tổng hợp của bài post số {i}. Bàn về {random.choice(SYNTHETIC_SEARCH_TERMS)}.",
            "dwellTimeThreshold": random.randint(2000, 8000), # 2-8 giây
            "createdAt": created_at.isoformat()
        })
    df = pd.DataFrame(posts)
    df.to_csv(f"{DATA_PATH}/posts.csv", index=False)
    print(f"Đã tạo {len(posts)} posts.")
    return df

def generate_interactions(users_df, posts_df):
    """
    Tạo train_interactions.csv và test_interactions.csv
    Đây là phần cốt lõi, sử dụng mô hình Latent Factor.
    """
    print("Bước 3: Đang tạo Interactions (Train & Test)...")
    
    user_ids = users_df['id'].tolist()
    post_ids = posts_df['id'].tolist()
    post_thresholds = dict(zip(posts_df['id'], posts_df['dwellTimeThreshold']))
    
    # 1. Tạo Latent Factors (Vector "Gu")
    U = np.random.normal(size=(N_USERS, LATENT_DIMS))
    V = np.random.normal(size=(N_POSTS, LATENT_DIMS))
    
    # 2. Tạo Bias (Độ phổ biến & Nhiễu)
    post_popularity = np.random.normal(0, POPULARITY_EFFECT, size=(N_POSTS))
    
    train_interactions_data = []
    test_interactions_data = []
    
    for u_idx in tqdm(range(N_USERS)):
        user_id = user_ids[u_idx]
        
        # 3. Tính điểm số (Scores)
        scores = U[u_idx] @ V.T + post_popularity + np.random.normal(0, NOISE_LEVEL, N_POSTS)
        
        # 4. Chọn các tương tác "chất lượng cao" (Ground Truth)
        # Sử dụng log-normal để tạo phân phối long-tail
        n_high_intent = int(np.random.lognormal(mean=np.log(AVG_INTERACTIONS_PER_USER), sigma=0.5)) + 1
        
        # Lấy thêm 50 ứng viên nữa để làm "View" nhiễu
        n_candidates = n_high_intent + 50 
        
        top_indices = np.argsort(-scores)[:n_candidates]
        
        high_intent_indices = top_indices[:n_high_intent]
        low_intent_indices = top_indices[n_high_intent:] # Đây là các "view"
        
        # Biến các tương tác chất lượng cao thành Post
        ground_truth_items = [post_ids[i] for i in high_intent_indices]
        
        # 5. Phân chia Train/Test cho Ground Truth
        random.shuffle(ground_truth_items)
        split_point = int(len(ground_truth_items) * 0.8) # 80% train, 20% test
        
        if len(ground_truth_items) < 2:
            train_items = ground_truth_items
            test_items = []
        else:
            train_items = ground_truth_items[:split_point]
            test_items = ground_truth_items[split_point:]

        # 6. Tạo file TEST (Đáp án)
        for post_id in test_items:
            test_interactions_data.append({
                "userId": user_id,
                "postId": post_id
            })
            
        # 7. Tạo file TRAIN (Dữ liệu học)
        
        # 7a. Thêm các tương tác "chất lượng cao" (LIKE) vào train
        for post_id in train_items:
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": "LIKE",
                "dwellTime": None,
                "searchText": None,
                "createdAt": datetime.datetime.now().isoformat() # Có thể làm ngày giả
            })
            
            # Thêm 1 view "chất lượng" cho mỗi Like
            threshold = post_thresholds[post_id]
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": "POST_VIEW",
                "dwellTime": threshold + random.randint(1000, 5000), # Vượt ngưỡng
                "searchText": None,
                "createdAt": datetime.datetime.now().isoformat()
            })

        # 7b. Thêm các tương tác "chất lượng thấp" (VIEW nhiễu) vào train
        for post_idx in low_intent_indices:
            post_id = post_ids[post_idx]
            threshold = post_thresholds[post_id]
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": "POST_VIEW",
                "dwellTime": random.randint(100, max(200, threshold - 100)), # Dưới ngưỡng
                "searchText": None,
                "createdAt": datetime.datetime.now().isoformat()
            })
            
        # 7c. Thêm tương tác "SEARCH" vào train
        if random.random() < 0.2: # 20% user có tìm kiếm
            n_searches = random.randint(1, 3)
            for _ in range(n_searches):
                train_interactions_data.append({
                    "id": f"{uuid.uuid4()}",
                    "userId": user_id,
                    "postId": None,
                    "type": "SEARCH",
                    "dwellTime": None,
                    "searchText": random.choice(SYNTHETIC_SEARCH_TERMS),
                    "createdAt": datetime.datetime.now().isoformat()
                })

    # 8. Lưu 2 file CSV
    df_train = pd.DataFrame(train_interactions_data)
    df_train.to_csv(f"{DATA_PATH}/train_interactions.csv", index=False)
    
    df_test = pd.DataFrame(test_interactions_data)
    df_test.to_csv(f"{DATA_PATH}/test_interactions.csv", index=False)
    
    print(f"Đã tạo {len(df_train)} tương tác train.")
    print(f"Đã tạo {len(df_test)} tương tác test (ground truth).")

# --- 4. CHẠY KỊCH BẢN ---
if __name__ == "__main__":
    users_df = generate_users()
    posts_df = generate_posts(users_df['id'].tolist())
    generate_interactions(users_df, posts_df)
    
    print("\n--- HOÀN TẤT! ---")
    print(f"Đã tạo 4 file CSV trong thư mục: {DATA_PATH}")
    print("1. users.csv")
    print("2. posts.csv")
    print("3. train_interactions.csv (Dùng để nuôi vào NestJS)")
    print("4. test_interactions.csv (Dùng làm 'Đáp án' để đánh giá)")