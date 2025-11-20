import pandas as pd
import numpy as np
import random
import uuid
import os
from tqdm import tqdm
from collections import defaultdict
import datetime

# --- 1. CẤU HÌNH ---
N_USERS = 10000
N_POSTS = 50000
LATENT_DIMS = 64 # Số chiều "sở thích" (gu)
DATA_PATH = './data_synthetic.log' # Thư mục để lưu CSV

# Cấu hình mô phỏng
AVG_INTERACTIONS_PER_USER = 15 # Số tương tác "chất lượng cao" trung bình
POPULARITY_EFFECT = 0.3 # Ảnh hưởng của độ phổ biến
NOISE_LEVEL = 0.1 # Độ nhiễu ngẫu nhiên

# Cấu hình mới
REPLY_POST_PROBABILITY = 0.15 # 15% posts là replies
REPLY_INTERACTION_PROB = 0.2 # 20% tương tác "chất lượng cao" là REPLY thay vì LIKE
UNLIKE_PROBABILITY = 0.1 # 10% các LIKE sẽ bị UNLIKE sau đó

# Cấu hình Mục 1: Mạng xã hội
AVG_FOLLOWING_PER_USER = 25 # Trung bình mỗi user follow 25 người
FOLLOW_BIAS_RATIO = 0.8 # 80% tương tác đến từ người mình follow

SYNTHETIC_SEARCH_TERMS = [
    "lập trình nestjs", "hướng dẫn react", "đánh giá gpt-4", "công thức nấu ăn",
    "du lịch đà lạt", "crypto hôm nay", "phim chiếu rạp", "tin tức a.i",
    "học machine learning", "so sánh s23 ultra", "chăm sóc da"
]

print(f"Bắt đầu tạo dữ liệu: {N_USERS} users, {N_POSTS} posts...")

# --- 2. TẠO THƯ MỤC ---
os.makedirs(DATA_PATH, exist_ok=True)

# --- 3. CÁC HÀM TẠO DỮ LIỆU ---

def get_random_timestamp():
    """Tạo một timestamp ngẫu nhiên trong 1 năm qua."""
    start_date = datetime.datetime.now() - datetime.timedelta(days=365)
    random_days = random.randint(0, 364)
    random_seconds = random.randint(0, 86399)
    return start_date + datetime.timedelta(days=random_days, seconds=random_seconds)

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

def generate_follows(users_df):
    """[MỤC 1] Tạo file follows.csv"""
    print("Bước 1.5: Đang tạo Mạng lưới Follow...")
    user_ids = users_df['id'].tolist()
    follows_data = []
    
    # Dùng lognormal để tạo phân phối "long-tail" cho số lượng user MÌNH follow
    # Một số user sẽ "tích cực" follow nhiều người
    n_following_list = np.random.lognormal(mean=np.log(AVG_FOLLOWING_PER_USER), sigma=0.8, size=N_USERS).astype(int) + 1
    
    for i in tqdm(range(N_USERS)):
        follower_id = user_ids[i]
        # Giới hạn số người follow không vượt quá tổng số user
        n_to_follow = min(n_following_list[i], N_USERS - 1) 
        
        # Chọn ngẫu nhiên N user để follow, đảm bảo không follow chính mình
        possible_targets = [uid for uid in user_ids if uid != follower_id]
        if not possible_targets:
            continue
            
        # Điều chỉnh n_to_follow nếu nó lớn hơn số target có thể
        n_to_follow = min(n_to_follow, len(possible_targets))
            
        following_list = random.sample(possible_targets, n_to_follow)
        
        for following_id in following_list:
            follows_data.append({
                "followerId": follower_id,
                "followingId": following_id
            })
            
    df = pd.DataFrame(follows_data)
    df.to_csv(f"{DATA_PATH}/follows.csv", index=False)
    print(f"Đã tạo {len(df)} mối quan hệ follow.")
    return df

def generate_posts(user_ids):
    """Tạo file posts.csv, bao gồm cả reply posts."""
    print("Bước 2: Đang tạo Posts...")
    posts = []
    
    for i in tqdm(range(N_POSTS), desc="  Tạo posts cơ bản"):
        posts.append({
            "id": f"{uuid.uuid4()}",
            "authorId": random.choice(user_ids),
            "content": f"Nội dung tổng hợp của bài post số {i}. Bàn về {random.choice(SYNTHETIC_SEARCH_TERMS)}.",
            "dwellTimeThreshold": random.randint(2000, 8000), # 2-8 giây
            "createdAt": get_random_timestamp().isoformat(),
            "parentId": None,
            "isReply": False
        })
        
    # Gán parentId cho các replies
    post_ids = [p['id'] for p in posts]
    for post in tqdm(posts, desc="  Gán parentIds cho replies"):
        if random.random() < REPLY_POST_PROBABILITY:
            # Đảm bảo post reply không reply chính nó
            possible_parents = [pid for pid in post_ids if pid != post['id']]
            if possible_parents:
                post['parentId'] = random.choice(possible_parents)
                post['isReply'] = True

    df = pd.DataFrame(posts)
    df.to_csv(f"{DATA_PATH}/posts.csv", index=False)
    print(f"Đã tạo {len(posts)} posts (bao gồm replies).")
    return df

def generate_interactions(users_df, posts_df, follows_df):
    """
    [MỤC 1 CẬP NHẬT]
    Tạo train_interactions.csv và test_interactions.csv
    Bao gồm LIKE, UNLIKE, REPLY_POST, POST_VIEW, SEARCH
    VÀ ÁP DỤNG "FOLLOW BIAS"
    """
    print("Bước 3: Đang tạo Interactions (Train & Test) với Follow Bias...")
    
    user_ids = users_df['id'].tolist()
    post_ids = posts_df['id'].tolist()
    post_authors = posts_df['authorId'].tolist() # Cần danh sách author theo thứ tự
    post_info = {row['id']: (row['dwellTimeThreshold'], row['parentId']) for _, row in posts_df.iterrows()}
    
    # Tạo follow_map để tra cứu nhanh O(1)
    follow_map = defaultdict(set)
    for _, row in follows_df.iterrows():
        follow_map[row['followerId']].add(row['followingId'])
    
    # 1. Tạo Latent Factors (Vector "Gu")
    U = np.random.normal(size=(N_USERS, LATENT_DIMS))
    V = np.random.normal(size=(N_POSTS, LATENT_DIMS))
    
    # 2. Tạo Bias (Độ phổ biến & Nhiễu)
    post_popularity = np.random.normal(0, POPULARITY_EFFECT, size=(N_POSTS))
    
    train_interactions_data = []
    test_interactions_data = []
    
    for u_idx in tqdm(range(N_USERS)):
        user_id = user_ids[u_idx]
        user_following_set = follow_map.get(user_id, set())
        
        # 3. Phân chia post pools
        following_post_indices = []
        discovery_post_indices = []
        
        for p_idx in range(N_POSTS):
            post_author_id = post_authors[p_idx]
            # Bỏ qua posts của chính mình
            if post_author_id == user_id: 
                continue
            
            if post_author_id in user_following_set:
                following_post_indices.append(p_idx)
            else:
                discovery_post_indices.append(p_idx)
        
        # 4. Tính điểm số (Scores)
        scores = U[u_idx] @ V.T + post_popularity + np.random.normal(0, NOISE_LEVEL, N_POSTS)
        
        # 5. Chọn các tương tác "chất lượng cao" (Ground Truth)
        n_high_intent = int(np.random.lognormal(mean=np.log(AVG_INTERACTIONS_PER_USER), sigma=0.5)) + 1
        n_low_intent = 50 # Giữ nguyên số lượng noise

        # Phân bổ số lượng theo bias
        n_high_follow = int(n_high_intent * FOLLOW_BIAS_RATIO)
        n_high_discovery = n_high_intent - n_high_follow
        
        n_low_follow = int(n_low_intent * FOLLOW_BIAS_RATIO)
        n_low_discovery = n_low_intent - n_low_follow

        # Lấy top N từ mỗi pool, dựa trên điểm scores
        
        # Lọc scores cho từng pool
        # Dùng np.take để lấy scores tại các index cụ thể
        if not following_post_indices:
            scores_follow = np.array([])
        else:
            scores_follow = np.take(scores, following_post_indices)
            
        if not discovery_post_indices:
            scores_discovery = np.array([])
        else:
            scores_discovery = np.take(scores, discovery_post_indices)
            
        # Sắp xếp (lấy index local)
        top_follow_indices_local = np.argsort(-scores_follow)
        top_discovery_indices_local = np.argsort(-scores_discovery)

        # Lấy high-intent
        # Dùng np.take để map local index -> global post index
        high_intent_follow = np.take(following_post_indices, top_follow_indices_local[:n_high_follow]) if len(scores_follow) > 0 else np.array([])
        high_intent_discovery = np.take(discovery_post_indices, top_discovery_indices_local[:n_high_discovery]) if len(scores_discovery) > 0 else np.array([])
        
        # Lấy low-intent (bỏ qua phần high-intent đã lấy)
        low_intent_follow = np.take(following_post_indices, top_follow_indices_local[n_high_follow : n_high_follow + n_low_follow]) if len(scores_follow) > n_high_follow else np.array([])
        low_intent_discovery = np.take(discovery_post_indices, top_discovery_indices_local[n_high_discovery : n_high_discovery + n_low_discovery]) if len(scores_discovery) > n_high_discovery else np.array([])

        # Gộp lại
        high_intent_indices = np.concatenate([high_intent_follow, high_intent_discovery]).astype(int).tolist()
        low_intent_indices = np.concatenate([low_intent_follow, low_intent_discovery]).astype(int).tolist()
            
        # Biến các tương tác chất lượng cao thành Post
        ground_truth_items = [post_ids[i] for i in high_intent_indices]
        
        # 6. Phân chia Train/Test cho Ground Truth
        random.shuffle(ground_truth_items)
        split_point = int(len(ground_truth_items) * 0.8) # 80% train, 20% test
        
        if len(ground_truth_items) < 2:
            train_items = ground_truth_items
            test_items = []
        else:
            train_items = ground_truth_items[:split_point]
            test_items = ground_truth_items[split_point:]

        # ... (PHẦN NÀY GIỮ NGUYÊN SO VỚI FILE TRƯỚC) ...

        # 7. Tạo file TEST (Đáp án)
        for post_id in test_items:
            test_interactions_data.append({
                "userId": user_id,
                "postId": post_id
            })
            
        # 8. Tạo file TRAIN (Dữ liệu học)
        
        # 8a. Thêm các tương tác "chất lượng cao" (LIKE, REPLY) vào train
        for post_id in train_items:
            base_created_at = get_random_timestamp()
            threshold, parent_id = post_info[post_id]
            
            # Quyết định là LIKE hay REPLY
            # (Chỉ reply vào post gốc, không reply vào reply)
            if parent_id is None and random.random() < REPLY_INTERACTION_PROB:
                interaction_type = "REPLY_POST"
            else:
                interaction_type = "LIKE"
                
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": interaction_type,
                "dwellTime": None,
                "searchText": None,
                "createdAt": base_created_at.isoformat()
            })
            
            # 8b. Thêm 1 view "chất lượng" cho mỗi tương tác trên
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": "POST_VIEW",
                "dwellTime": threshold + random.randint(1000, 5000), # Vượt ngưỡng
                "searchText": None,
                "createdAt": (base_created_at - datetime.timedelta(seconds=10)).isoformat() # View xảy ra trước
            })
            
            # 8c. Thêm UNLIKE cho một số LIKE
            if interaction_type == "LIKE" and random.random() < UNLIKE_PROBABILITY:
                # Unlike xảy ra sau khi Like
                unlike_at = base_created_at + datetime.timedelta(days=random.randint(1, 30))
                train_interactions_data.append({
                    "id": f"{uuid.uuid4()}",
                    "userId": user_id,
                    "postId": post_id,
                    "type": "UNLIKE",
                    "dwellTime": None,
                    "searchText": None,
                    "createdAt": unlike_at.isoformat()
                })

        # 8d. Thêm các tương tác "chất lượng thấp" (VIEW nhiễu) vào train
        for post_idx in low_intent_indices:
            post_id = post_ids[post_idx]
            threshold, _ = post_info[post_id]
            train_interactions_data.append({
                "id": f"{uuid.uuid4()}",
                "userId": user_id,
                "postId": post_id,
                "type": "POST_VIEW",
                "dwellTime": random.randint(100, max(200, threshold - 100)), # Dưới ngưỡng
                "searchText": None,
                "createdAt": get_random_timestamp().isoformat()
            })
            
        # 8e. Thêm tương tác "SEARCH" vào train
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
                    "createdAt": get_random_timestamp().isoformat()
                })

    # 9. Lưu 2 file CSV
    df_train = pd.DataFrame(train_interactions_data)
    # Sắp xếp theo thời gian để mô phỏng thực tế
    df_train = df_train.sort_values(by="createdAt").reset_index(drop=True)
    df_train.to_csv(f"{DATA_PATH}/train_interactions.csv", index=False)
    
    df_test = pd.DataFrame(test_interactions_data)
    df_test.to_csv(f"{DATA_PATH}/test_interactions.csv", index=False)
    
    print(f"Đã tạo {len(df_train)} tương tác train.")
    print(f"Đã tạo {len(df_test)} tương tác test (ground truth).")

# --- 4. CHẠY KỊCH BẢN ---
if __name__ == "__main__":
    users_df = generate_users()
    follows_df = generate_follows(users_df) # <--- MỚI
    posts_df = generate_posts(users_df['id'].tolist())
    
    # Truyền follows_df vào hàm generate_interactions
    generate_interactions(users_df, posts_df, follows_df) # <--- CẬP NHẬT
    
    print("\n--- HOÀN TẤT! ---")
    print(f"Đã tạo 5 file CSV trong thư mục: {DATA_PATH}")
    print("1. users.csv")
    print("2. posts.csv (đã có parentId, isReply)")
    print("3. follows.csv (MỚI - Mạng xã hội)")
    print("4. train_interactions.csv (đã có LIKE, UNLIKE, REPLY_POST, SEARCH và Follow Bias)")
    print("5. test_interactions.csv (Dùng làm 'Đáp án' để đánh giá)")


# Normalize cosine formula 
# $$Similarity = \frac{Overlap}{\sqrt{|A| \times |B|}}$$
# Feed được đánh giá:      cf
# Số user được đánh giá: 10000
# Mean Precision@10:     0.21%
# Mean Recall@10:        0.53%
# MAP@10:                0.31%

# Công thức chế biến linh tinh
# $$Score = \frac{Overlap}{\sqrt{Overlap \times |A|}} = \sqrt{\frac{Overlap}{|A|}}$$
# Feed được đánh giá:      cf
# Số user được đánh giá: 10000
# Mean Precision@10:     0.21%
# Mean Recall@10:        0.53%
# MAP@10:                0.37%