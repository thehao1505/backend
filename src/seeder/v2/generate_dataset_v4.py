from google import genai
from google.genai import types
import pandas as pd
import numpy as np
import random
import uuid
import os
import datetime
from tqdm import tqdm

# ==============================================================================
# 1. CẤU HÌNH (CONFIG)
# ==============================================================================

# [QUAN TRỌNG] Thay bằng API Key của bạn
GEMINI_API_KEY = "" 

# Cấu hình Dữ liệu
N_USERS = 300           # Số lượng user giả lập
N_POSTS = 1000          # Số lượng bài viết giả lập
DATA_PATH = './data_synthetic_v4'
EMBEDDING_MODEL = "text-embedding-004" # BẮT BUỘC khớp với embedding.service.ts

# Cấu hình Chủ đề (Topics)
# Mô tả này sẽ được gửi lên Google GenAI để lấy vector gốc
TOPICS = {
    "TECH": { 
        "desc": "Software Engineering, Coding, React, NestJS, Docker, Kubernetes, Artificial Intelligence, Machine Learning, Python, System Design.",
        "keywords": ["React", "NestJS", "Docker", "Kubernetes", "AI", "Python", "DevOps"] 
    },
    "TRAVEL": { 
        "desc": "Traveling around the world, Backpacking, Camping in the forest, Hiking mountains, Beautiful beaches, Luxury Resorts, Homestays.",
        "keywords": ["Đà Lạt", "Camping", "Biển", "Resort", "Homestay", "Phượt", "Leo núi"] 
    },
    "FOOD": { 
        "desc": "Delicious food, Culinary arts, Street food, Fine dining, Sushi, Pizza, Pho noodles, Coffee culture, Cooking recipes.",
        "keywords": ["Phở", "Sushi", "Coffee", "Street Food", "Pizza", "Dimsum", "Trà sữa"] 
    },
    "FINANCE": { 
        "desc": "Financial freedom, Investment strategies, Stock market, Cryptocurrency, Real Estate, Personal Finance, Passive Income.",
        "keywords": ["Crypto", "Stock", "BĐS", "Gold", "Invest", "Bitcoin", "Chứng khoán"] 
    },
    "LIFESTYLE": { 
        "desc": "Minimalist lifestyle, Self-improvement, Meditation, Gym workout, Yoga practice, Reading books, Healthy living.",
        "keywords": ["Gym", "Yoga", "Book", "Meditation", "Minimalism", "Healthy", "Workout"] 
    }
}

# Khởi tạo Client mới
client = genai.Client(api_key=GEMINI_API_KEY)

# ==============================================================================
# 2. CORE FUNCTIONS
# ==============================================================================

def get_topic_embeddings():
    """
    Sử dụng SDK mới (google-genai) để lấy embedding cho các chủ đề.
    """
    topic_keys = list(TOPICS.keys())
    descriptions = [TOPICS[k]["desc"] for k in topic_keys]
    
    print(f"📡 Calling Google GenAI SDK to embed {len(topic_keys)} topics...")
    
    try:
        # Gọi API model.embed_content
        response = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=descriptions,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT", # Tối ưu vector cho việc lưu vào DB
                title="Topic Descriptions"      # Metadata title (optional)
            )
        )
        
        # Trích xuất vector từ response object
        # response.embeddings là list các Embedding object, mỗi object có thuộc tính .values
        embeddings = np.array([e.values for e in response.embeddings])
        
        return {topic_keys[i]: embeddings[i] for i in range(len(topic_keys))}
        
    except Exception as e:
        print(f"❌ Error calling GenAI SDK: {e}")
        print("⚠️ Using Random Vectors fallback (Results will be poor)")
        return {k: np.random.normal(0, 0.1, 768) for k in topic_keys}

def get_random_timestamp():
    start = datetime.datetime.now() - datetime.timedelta(days=90)
    return start + datetime.timedelta(seconds=random.randint(0, 90*24*3600))

# ==============================================================================
# 3. MAIN PROCESS
# ==============================================================================

def main():
    print(f"🚀 STARTING GENERATION ({N_USERS} Users, {N_POSTS} Posts)")
    os.makedirs(DATA_PATH, exist_ok=True)

    # ---------------------------------------------------------
    # BƯỚC 1: Lấy Vector Gốc từ Google GenAI
    # ---------------------------------------------------------
    topic_vec_map = get_topic_embeddings()
    topic_keys = list(TOPICS.keys())

    # ---------------------------------------------------------
    # BƯỚC 2: Sinh Users (Dựa trên Vector Chủ đề)
    # ---------------------------------------------------------
    print("🔹 1. Generating Users...")
    user_ids = [str(uuid.uuid4()) for _ in range(N_USERS)]
    users_data = []
    U_matrix = []

    for i in range(N_USERS):
        # Mỗi user thích 1 hoặc 2 chủ đề ngẫu nhiên
        chosen_topics = random.sample(topic_keys, k=random.choices([1, 2], weights=[0.7, 0.3])[0])
        
        # Vector User = Trung bình cộng các Topic Vector + Nhiễu (Noise)
        base_vec = np.mean([topic_vec_map[t] for t in chosen_topics], axis=0)
        user_vec = base_vec + np.random.normal(0, 0.05, 768) 
        U_matrix.append(user_vec)
        
        # Tạo Bio text khớp với chủ đề (để Ingest sau này chạy đúng)
        keywords = []
        for t in chosen_topics:
            keywords.extend(TOPICS[t]["keywords"])
        desc_text = " | ".join(random.sample(keywords, min(4, len(keywords))))

        users_data.append({
            "id": user_ids[i],
            "username": f"user_{i}",
            "firstName": "User", "lastName": str(i),
            "shortDescription": desc_text
        })
    
    pd.DataFrame(users_data).to_csv(f"{DATA_PATH}/users.csv", index=False)

    # ---------------------------------------------------------
    # BƯỚC 3: Sinh Posts (Dựa trên Vector Chủ đề)
    # ---------------------------------------------------------
    print("🔹 2. Generating Posts...")
    post_ids = [str(uuid.uuid4()) for _ in range(N_POSTS)]
    posts_data = []
    post_author_map = {}
    V_matrix = []

    for i in range(N_POSTS):
        uid = random.choice(user_ids)
        post_author_map[post_ids[i]] = uid
        
        # Post thuộc 1 chủ đề
        topic = random.choice(topic_keys)
        
        # Vector Post = Topic Vector + Nhiễu
        post_vec = topic_vec_map[topic] + np.random.normal(0, 0.05, 768)
        V_matrix.append(post_vec)
        
        # Tạo Content text khớp với chủ đề
        kws = TOPICS[topic]["keywords"]
        selected_kw = random.sample(kws, 2)
        content = f"Sharing my thoughts on {selected_kw[0]} and {selected_kw[1]}. Truly amazing experience with {TOPICS[topic]['desc']}."

        posts_data.append({
            "id": post_ids[i], "authorId": uid,
            "content": content,
            "dwellTimeThreshold": 3000,
            "createdAt": get_random_timestamp().isoformat()
        })
    
    pd.DataFrame(posts_data).to_csv(f"{DATA_PATH}/posts.csv", index=False)

    # ---------------------------------------------------------
    # BƯỚC 4: Sinh Follows (Giả lập)
    # ---------------------------------------------------------
    print("🔹 3. Generating Social Graph...")
    follows_data = []
    for i in range(N_USERS):
        targets = random.sample(user_ids, k=random.randint(2, 8))
        for t in targets:
            if t != user_ids[i]:
                follows_data.append({"followerId": user_ids[i], "followingId": t})
    pd.DataFrame(follows_data).to_csv(f"{DATA_PATH}/follows.csv", index=False)

    # ---------------------------------------------------------
    # BƯỚC 5: Sinh Interactions (Semantic Matching - Dot Product)
    # ---------------------------------------------------------
    print("🔹 4. Generating Interactions...")
    
    U_matrix = np.array(U_matrix)
    V_matrix = np.array(V_matrix)
    
    # Tính độ tương đồng giữa User và Post
    # Vì cả hai đều sinh từ vector gốc của Gemini, phép nhân này phản ánh đúng "gu"
    scores_matrix = np.dot(U_matrix, V_matrix.T)
    
    interactions_train = []
    
    for i in tqdm(range(N_USERS)):
        uid = user_ids[i]
        u_scores = scores_matrix[i]
        
        # Lấy Top 150 bài hợp gu nhất
        top_indices = np.argsort(-u_scores)[:150]
        
        # Loại bỏ bài của chính mình
        candidate_pool = [post_ids[idx] for idx in top_indices if post_author_map[post_ids[idx]] != uid]
        if not candidate_pool: continue

        # Chọn ngẫu nhiên 10-40 bài từ tập hợp gu
        n_inter = random.randint(10, 40)
        final_posts = random.sample(candidate_pool, min(n_inter, len(candidate_pool)))
        
        base_time = get_random_timestamp()
        
        for pid in final_posts:
            base_time += datetime.timedelta(minutes=random.randint(10, 120))
            
            # 1. VIEW (Implicit) - Luôn xảy ra
            interactions_train.append({
                "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
                "type": "POST_VIEW", "dwellTime": 10000, "searchText": "",
                "createdAt": base_time.isoformat(),
                "weight": 0.15
            })
            
            # 2. ACTION (Explicit) - Xác suất 40%
            if random.random() < 0.4:
                act_type = random.choices(["LIKE", "SHARE", "POST_CLICK"], weights=[0.6, 0.2, 0.2])[0]
                weight = 0.15 if act_type == "LIKE" else (0.35 if act_type == "SHARE" else 0.25)
                
                interactions_train.append({
                    "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
                    "type": act_type, "dwellTime": "", "searchText": "",
                    "createdAt": (base_time + datetime.timedelta(seconds=10)).isoformat(),
                    "weight": weight
                })

    # ---------------------------------------------------------
    # BƯỚC 6: Chia Train/Test & Lưu file
    # ---------------------------------------------------------
    print("🔹 5. Splitting Train/Test...")
    df_inter = pd.DataFrame(interactions_train)
    df_inter['createdAt'] = pd.to_datetime(df_inter['createdAt'])
    df_inter = df_inter.sort_values(['userId', 'createdAt'])
    
    train_list, test_list = [], []
    
    for uid, group in df_inter.groupby('userId'):
        if len(group) < 5:
            train_list.append(group)
            continue
        
        split_idx = int(len(group) * 0.8)
        train_list.append(group.iloc[:split_idx])
        
        # Test Set: Chỉ lấy Positive Interactions (Weight >= 0.15)
        test_items = group.iloc[split_idx:]
        test_positives = test_items[test_items['weight'] >= 0.15]
        test_list.append(test_positives)
        
    df_train = pd.concat(train_list)
    df_test = pd.concat(test_list)
    
    df_train.fillna("", inplace=True)
    df_test.fillna("", inplace=True)
    
    df_train.to_csv(f"{DATA_PATH}/train_interactions.csv", index=False)
    df_test[['userId', 'postId']].to_csv(f"{DATA_PATH}/test_interactions.csv", index=False)

    print(f"\n✅ SUCCESS! Data generated in '{DATA_PATH}' using google-genai SDK.")
    print(f"   - Users: {len(users_data)}")
    print(f"   - Posts: {len(posts_data)}")
    print(f"   - Train: {len(df_train)}")
    print(f"   - Test: {len(df_test)}")

if __name__ == "__main__":
    main()