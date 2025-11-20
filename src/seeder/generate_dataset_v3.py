import pandas as pd
import numpy as np
import random
import uuid
import os
from tqdm import tqdm
from collections import defaultdict
import datetime

# --- 1. CẤU HÌNH ---
N_USERS = 500           # Giảm xuống để test nhanh, tăng lên 2000 khi chạy thật
N_POSTS = 2000
LATENT_DIMS = 768       
DATA_PATH = './data_synthetic_v3'

# Cấu hình hành vi
AVG_INTERACTIONS = 30
REPLY_PROB = 0.05       # 5% Reply (High effort)
SHARE_PROB = 0.05       # 5% Share (High effort)
CLICK_PROB = 0.20       # 20% Click
LIKE_PROB = 0.30        # 30% Like
# Còn lại là View (Implicit)

# --- 2. SEMANTIC ENGINE ---
TOPICS = {
    "TECH": { "range": (0, 100), "keywords": ["React", "NestJS", "Docker", "Kubernetes", "Microservices", "TypeScript", "Redis", "MongoDB"], "bios": ["Backend Dev", "System Architect"] },
    "TRAVEL": { "range": (100, 200), "keywords": ["Đà Lạt", "Phú Quốc", "Camping", "Hiking", "Resort", "Homestay", "Biển", "Núi"], "bios": ["Travel Blogger", "Wanderlust"] },
    "FOOD": { "range": (200, 300), "keywords": ["Phở Bò", "Bún Chả", "Sushi", "Sashimi", "Coffee", "Matcha", "Street Food"], "bios": ["Foodie", "Chef"] },
    "FINANCE": { "range": (300, 400), "keywords": ["Crypto", "Stock", "VNIndex", "Real Estate", "Gold", "Passive Income"], "bios": ["Investor", "Financial Advisor"] },
    "LIFESTYLE": { "range": (400, 768), "keywords": ["Minimalism", "Gym", "Yoga", "Reading", "Meditation", "Self-help"], "bios": ["Lifestyle Coach", "Reader"] }
}

def generate_semantic_vectors(n_samples):
    vectors = np.random.normal(0, 0.05, size=(n_samples, LATENT_DIMS))
    topic_keys = list(TOPICS.keys())
    for i in range(n_samples):
        chosen_topics = random.sample(topic_keys, k=random.choices([1, 2], weights=[0.8, 0.2])[0])
        for topic in chosen_topics:
            start, end = TOPICS[topic]["range"]
            vectors[i, start:end] += np.random.normal(0.8, 0.2, size=(end-start))
    return vectors

def vector_to_text(vector, type="post"):
    selected = []
    for topic, conf in TOPICS.items():
        start, end = conf["range"]
        if np.mean(vector[start:end]) > 0.2:
            pool = conf["keywords"] if type == "post" else conf["bios"]
            selected.extend(random.sample(pool, k=min(2, len(pool))))
    
    if not selected:
        pool = TOPICS[random.choice(list(TOPICS.keys()))]["keywords" if type == "post" else "bios"]
        selected = random.sample(pool, k=2)
        
    if type == "post":
        return f"Bài viết về {', '.join(selected)}. #{selected[0].replace(' ','')}"
    return " | ".join(list(set(selected)))

def get_random_timestamp():
    start = datetime.datetime.now() - datetime.timedelta(days=365)
    return start + datetime.timedelta(seconds=random.randint(0, 365*24*3600))

# --- 3. MAIN ---

def main():
    print(f"🚀 Bắt đầu sinh dữ liệu System-Aligned ({N_USERS} users, {N_POSTS} posts)...")
    os.makedirs(DATA_PATH, exist_ok=True)

    # A. Users
    print("🔹 1. Generating Users...")
    U_matrix = generate_semantic_vectors(N_USERS)
    user_ids = [str(uuid.uuid4()) for _ in range(N_USERS)]
    users_data = []
    for i in range(N_USERS):
        users_data.append({
            "id": user_ids[i],
            "username": f"user_{i}",
            "firstName": f"User",
            "lastName": f"{i}",
            "shortDescription": vector_to_text(U_matrix[i], type="user")
        })
    pd.DataFrame(users_data).to_csv(f"{DATA_PATH}/users.csv", index=False)

    # B. Posts
    print("🔹 2. Generating Posts...")
    V_matrix = generate_semantic_vectors(N_POSTS)
    post_ids = [str(uuid.uuid4()) for _ in range(N_POSTS)]
    posts_data = []
    post_author_map = {}
    
    for i in range(N_POSTS):
        uid = random.choice(user_ids)
        post_author_map[post_ids[i]] = uid
        posts_data.append({
            "id": post_ids[i],
            "authorId": uid,
            "content": vector_to_text(V_matrix[i], type="post"),
            "dwellTimeThreshold": 3000, # [SYSTEM] Ngưỡng 3s
            "createdAt": get_random_timestamp().isoformat()
        })
    pd.DataFrame(posts_data).to_csv(f"{DATA_PATH}/posts.csv", index=False)

    # C. Follows (Fake graph)
    print("🔹 3. Generating Social Graph...")
    follows_data = []
    for i in range(N_USERS):
        # Follow ngẫu nhiên 5-10 người
        n_follow = random.randint(5, 10)
        targets = random.sample(user_ids, n_follow)
        for t in targets:
            if t != user_ids[i]:
                follows_data.append({"followerId": user_ids[i], "followingId": t})
    pd.DataFrame(follows_data).to_csv(f"{DATA_PATH}/follows.csv", index=False)

    # D. Interactions (ALIGNED WITH SYSTEM LOGIC)
    print("🔹 4. Generating Interactions...")
    scores_matrix = U_matrix @ V_matrix.T + np.random.normal(0, 0.1, (N_USERS, N_POSTS))
    interactions_train = []
    
    for i in tqdm(range(N_USERS)):
        uid = user_ids[i]
        u_scores = scores_matrix[i]
        
        # Lấy Top items hợp gu
        top_indices = np.argsort(-u_scores)[:200]
        candidate_pool = [post_ids[idx] for idx in top_indices if post_author_map[post_ids[idx]] != uid]
        
        n_inter = int(np.random.normal(AVG_INTERACTIONS, 10))
        n_inter = max(5, n_inter)
        final_posts = random.sample(candidate_pool, min(n_inter, len(candidate_pool)))
        
        base_time = get_random_timestamp()
        
        # [SYSTEM] Sinh SEARCH Activity (để test search embedding)
        if random.random() < 0.3: # 30% user có search
             # Lấy keyword từ bios của user để search đúng gu
             keywords = users_data[i]["shortDescription"].split(" | ")
             if keywords:
                search_kw = random.choice(keywords)
                interactions_train.append({
                    "id": str(uuid.uuid4()), "userId": uid, "postId": "", # Search ko có postId
                    "type": "SEARCH", "dwellTime": "", "searchText": search_kw,
                    "createdAt": (base_time - datetime.timedelta(hours=1)).isoformat(),
                    "weight": 0.1 # Weight SEARCH
                })

        for pid in final_posts:
            base_time += datetime.timedelta(minutes=random.randint(5, 120))
            
            # [SYSTEM] DWELL TIME LOGIC
            # Sinh dwellTime ngẫu nhiên: 30% là lướt nhanh (< 3s), 70% là xem kỹ (> 3s)
            if random.random() < 0.3:
                dwell_time = random.randint(500, 2500) # < Threshold (Không tính là High Intent)
            else:
                dwell_time = random.randint(3500, 60000) # > Threshold (Tính là High Intent - POST_VIEW)
            
            # 1. Luôn sinh POST_VIEW
            interactions_train.append({
                "id": str(uuid.uuid4()), "userId": uid, "postId": pid, 
                "type": "POST_VIEW", "dwellTime": dwell_time, "searchText": "",
                "createdAt": base_time.isoformat(),
                "weight": 0.15 if dwell_time > 3000 else 0 
            })

            # 2. Hành động Explicit (dựa trên xác suất)
            rand = random.random()
            act_type = None
            weight = 0
            
            if rand < REPLY_PROB:
                act_type = "REPLY_POST" # [FIX] Khớp với enum trong code
                weight = 0.4
            elif rand < REPLY_PROB + SHARE_PROB:
                act_type = "SHARE"
                weight = 0.35
            elif rand < REPLY_PROB + SHARE_PROB + CLICK_PROB:
                act_type = "POST_CLICK"
                weight = 0.25
            elif rand < REPLY_PROB + SHARE_PROB + CLICK_PROB + LIKE_PROB:
                act_type = "LIKE"
                weight = 0.15
            
            if act_type:
                interactions_train.append({
                    "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
                    "type": act_type, "dwellTime": "", "searchText": "",
                    "createdAt": (base_time + datetime.timedelta(seconds=5)).isoformat(),
                    "weight": weight
                })

                # [SYSTEM] UNLIKE LOGIC (Negative Feedback)
                if act_type == "LIKE" and random.random() < 0.05:
                     interactions_train.append({
                        "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
                        "type": "UNLIKE", "dwellTime": "", "searchText": "",
                        "createdAt": (base_time + datetime.timedelta(days=1)).isoformat(),
                        "weight": -0.15
                    })

    # E. Split Train/Test
    df_inter = pd.DataFrame(interactions_train)
    df_inter['createdAt'] = pd.to_datetime(df_inter['createdAt'])
    df_inter = df_inter.sort_values(['userId', 'createdAt'])
    
    train_list, test_list = [], []
    
    for uid, group in tqdm(df_inter.groupby('userId')):
        if len(group) < 3:
            train_list.append(group)
            continue
            
        split_idx = int(len(group) * 0.8)
        train_list.append(group.iloc[:split_idx])
        
        # Test set: Chỉ lấy các hành động mang ý nghĩa Positive rõ ràng để evaluate
        # (Weight > 0.1 tức là không lấy view lướt nhanh, search hoặc unlike)
        test_items = group.iloc[split_idx:]
        test_positives = test_items[test_items['weight'] >= 0.15] 
        test_list.append(test_positives)

    df_train = pd.concat(train_list).sort_values('createdAt')
    df_test = pd.concat(test_list).sort_values('createdAt')
    
    # Fill NaN cho csv
    df_train.fillna("", inplace=True)
    df_test.fillna("", inplace=True)

    df_train.to_csv(f"{DATA_PATH}/train_interactions.csv", index=False)
    df_test[['userId', 'postId']].to_csv(f"{DATA_PATH}/test_interactions.csv", index=False) # Chỉ cần ID cho evaluate

    print(f"\n✅ HOÀN TẤT! Dữ liệu khớp với Logic Hệ Thống.")

if __name__ == "__main__":
    main()