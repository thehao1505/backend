import pandas as pd
import numpy as np
import random
import uuid
import os
from tqdm import tqdm
from collections import defaultdict
import datetime

# --- 1. CẤU HÌNH HỆ THỐNG ---
N_USERS = 2000          # Đủ lớn để test, đủ nhỏ để chạy nhanh
N_POSTS = 10000         # Kho hàng nội dung
LATENT_DIMS = 768       # [QUAN TRỌNG] Khớp với Gemini/OpenAI Embedding
DATA_PATH = './data_synthetic_unified' # Thư mục lưu file

# Cấu hình hành vi
AVG_INTERACTIONS = 25   # Tương tác trung bình/user
FOLLOW_BIAS = 0.6       # 60% tương tác đến từ Follow (CF mạnh ở đây)
NOISE_LEVEL = 0.05      # Nhiễu thấp để CBF dễ học
POPULARITY_BIAS = 0.1   # Bias độ phổ biến

# --- 2. CẦU NỐI NGỮ NGHĨA (SEMANTIC MAPPING) ---
# Chia 768 chiều thành các "vùng" chủ đề.
# Nếu Vector có giá trị cao ở vùng nào -> Sinh text vùng đó.
TOPICS = {
    "TECH": {
        "range": (0, 100), # Chiều 0-100
        "keywords": ["NestJS", "React", "TypeScript", "Docker", "Kubernetes", "AI", "Microservices", "Golang", "System Design", "Algorithm"],
        "bios": ["Lập trình viên Backend", "Fullstack Dev", "Đam mê Open Source", "Kỹ sư cầu nối", "Yêu thích công nghệ"]
    },
    "TRAVEL": {
        "range": (100, 200), # Chiều 100-200
        "keywords": ["Đà Lạt", "Sapa", "Hà Giang", "Biển Nha Trang", "Phú Quốc", "Cắm trại", "Leo núi", "Homestay view đẹp", "Săn mây"],
        "bios": ["Thích xê dịch", "Blogger du lịch", "Phượt thủ", "Yêu thiên nhiên", "Sống ảo"]
    },
    "FOOD": {
        "range": (200, 300), # Chiều 200-300
        "keywords": ["Phở bò", "Bún đậu", "Pizza", "Sushi", "Trà sữa", "Cà phê trứng", "Review đồ ăn", "Công thức nấu ăn", "Eat clean"],
        "bios": ["Tâm hồn ăn uống", "Food Reviewer", "Thích nấu ăn", "Nghiện trà sữa", "Đầu bếp tại gia"]
    },
    "FINANCE": {
        "range": (300, 400), # Chiều 300-400
        "keywords": ["Chứng khoán", "Bitcoin", "Bất động sản", "Đầu tư vàng", "Tài chính cá nhân", "Startup", "Kinh doanh online", "Passive Income"],
        "bios": ["Nhà đầu tư", "Crypto Trader", "Doanh nhân", "Quan tâm tài chính", "Shark Tank fan"]
    },
    "LIFESTYLE": {
        "range": (400, 768), # Chiều còn lại
        "keywords": ["Chạy bộ", "Gym", "Yoga", "Đọc sách", "Podcast", "Chữa lành", "Minimalism", "Thời trang", "GenZ"],
        "bios": ["Sống tích cực", "Yêu thể thao", "Mọt sách", "Healthy Lifestyle", "Content Creator"]
    }
}

print(f"🚀 Bắt đầu sinh dữ liệu chuẩn hóa ({N_USERS} users, {N_POSTS} posts)...")
os.makedirs(DATA_PATH, exist_ok=True)

# --- 3. HÀM HỖ TRỢ ---

def get_random_timestamp():
    start = datetime.datetime.now() - datetime.timedelta(days=365)
    return start + datetime.timedelta(seconds=random.randint(0, 365*24*3600))

def generate_semantic_vectors(n_samples):
    """
    Tạo ma trận vector (N x 768).
    Thay vì random hoàn toàn, ta 'kích hoạt' các vùng chủ đề ngẫu nhiên.
    """
    # Khởi tạo nền nhiễu thấp (Gaussian noise)
    vectors = np.random.normal(0, 0.05, size=(n_samples, LATENT_DIMS))
    topic_keys = list(TOPICS.keys())
    
    for i in range(n_samples):
        # Mỗi entity (user/post) sẽ mạnh về 1-2 chủ đề
        n_topics = random.choices([1, 2], weights=[0.7, 0.3])[0]
        chosen_topics = random.sample(topic_keys, n_topics)
        
        for topic in chosen_topics:
            start, end = TOPICS[topic]["range"]
            # Tăng giá trị ở vùng chủ đề này (Signal)
            vectors[i, start:end] += np.random.normal(0.8, 0.2, size=(end-start))
            
    return vectors

def vector_to_text(vector, type="post"):
    """Dịch Vector số học sang Văn bản (Text)."""
    selected_keywords = []
    selected_bios = []
    
    # Quét qua các vùng chủ đề
    for topic, conf in TOPICS.items():
        start, end = conf["range"]
        # Tính điểm trung bình của vùng này
        score = np.mean(vector[start:end])
        
        if score > 0.2: # Ngưỡng kích hoạt chủ đề
            if type == "post":
                selected_keywords.extend(random.sample(conf["keywords"], k=min(2, len(conf["keywords"]))))
            else:
                selected_bios.extend(random.sample(conf["bios"], k=1))
    
    # Fallback nếu vector quá yếu (ít gặp)
    if not selected_keywords and type == "post":
        topic = random.choice(list(TOPICS.keys()))
        selected_keywords = random.sample(TOPICS[topic]["keywords"], 2)
    if not selected_bios and type == "user":
        topic = random.choice(list(TOPICS.keys()))
        selected_bios = random.sample(TOPICS[topic]["bios"], 1)

    if type == "post":
        content = f"Bài viết hôm nay nói về {', '.join(selected_keywords)}. Mọi người nghĩ sao? #{selected_keywords[0].replace(' ','')}"
        return content
    else:
        return " | ".join(list(set(selected_bios)))

# --- 4. THỰC THI ---

# A. TẠO USER & VECTOR USER
print("🔹 Bước 1: Sinh Users & Vectors...")
U_matrix = generate_semantic_vectors(N_USERS) # (N x 768)
users_data = []
user_ids = [str(uuid.uuid4()) for _ in range(N_USERS)]

for i in tqdm(range(N_USERS)):
    bio = vector_to_text(U_matrix[i], type="user")
    users_data.append({
        "id": user_ids[i],
        "username": f"user_{i}",
        "firstName": "User",
        "lastName": str(i),
        "shortDescription": bio, # Text khớp với Vector U[i]
        "email": f"user_{i}@synthetic.com"
    })
pd.DataFrame(users_data).to_csv(f"{DATA_PATH}/users.csv", index=False)


# B. TẠO POST & VECTOR POST
print("🔹 Bước 2: Sinh Posts & Vectors...")
V_matrix = generate_semantic_vectors(N_POSTS) # (M x 768)
posts_data = []
post_ids = [str(uuid.uuid4()) for _ in range(N_POSTS)]

for i in tqdm(range(N_POSTS)):
    content = vector_to_text(V_matrix[i], type="post")
    posts_data.append({
        "id": post_ids[i],
        "authorId": random.choice(user_ids),
        "content": content, # Text khớp với Vector V[i]
        "dwellTimeThreshold": random.randint(3000, 8000),
        "createdAt": get_random_timestamp().isoformat(),
        "parentId": None, 
        "isReply": False
    })
# (Bỏ qua logic tạo reply phức tạp để tập trung vào vector match)
pd.DataFrame(posts_data).to_csv(f"{DATA_PATH}/posts.csv", index=False)


# C. TẠO FOLLOW (MẠNG XÃ HỘI)
print("🔹 Bước 3: Sinh Follow Graph...")
follows_data = []
# User có vector gần nhau thì dễ follow nhau hơn (Homophily)
# Để đơn giản và nhanh: Dùng Cosine Similarity trên U_matrix để gợi ý follow
# Lấy mẫu ngẫu nhiên để tính toán cho nhanh
for i in tqdm(range(N_USERS)):
    # Mỗi user follow khoảng 20 người
    # 70% là follow người CÙNG CHỦ ĐỀ (High Sim), 30% random
    
    # Tính Sim đơn giản: Dot product với 100 user ngẫu nhiên
    candidates_idx = np.random.choice(N_USERS, 100)
    scores = U_matrix[i] @ U_matrix[candidates_idx].T
    
    # Top sim
    top_k_idx = candidates_idx[np.argsort(-scores)[:15]] # 15 người cùng gu
    random_idx = np.random.choice(N_USERS, 5) # 5 người random
    
    targets = np.concatenate([top_k_idx, random_idx])
    
    for t_idx in targets:
        if user_ids[t_idx] == user_ids[i]: continue
        follows_data.append({
            "followerId": user_ids[i],
            "followingId": user_ids[t_idx]
        })
pd.DataFrame(follows_data).to_csv(f"{DATA_PATH}/follows.csv", index=False)


# D. TẠO TƯƠNG TÁC (INTERACTIONS - GROUND TRUTH)
print("🔹 Bước 4: Tính Interactions (Ma trận 768D)...")

# 1. Tính Score Matrix = U * V^T
# Vì ma trận lớn (2000 * 10000 = 20tr phần tử), ta tính từng block hoặc row
# Ở đây N=2000 chạy thẳng được.
scores_matrix = U_matrix @ V_matrix.T 
# Thêm Popularity Bias (Một số bài post có điểm cộng cho tất cả user)
popularity = np.random.normal(0, POPULARITY_BIAS, size=N_POSTS)
scores_matrix += popularity

train_data = []
test_data = []

# Build follow set for fast lookup
follow_map = defaultdict(set)
for f in follows_data: follow_map[f['followerId']].add(f['followingId'])
post_author_map = {p['id']: p['authorId'] for p in posts_data}

print("   -> Generating actions...")
for i in tqdm(range(N_USERS)):
    uid = user_ids[i]
    u_scores = scores_matrix[i]
    
    # Lấy top posts có điểm cao nhất (Hợp gu nhất)
    # Lấy nhiều hơn cần thiết để lọc
    top_indices = np.argsort(-u_scores)[:100] 
    
    # Phân loại: Follow vs Discovery
    following_posts = []
    discovery_posts = []
    
    for pid_idx in top_indices:
        pid = post_ids[pid_idx]
        author = post_author_map[pid]
        if author == uid: continue
        
        if author in follow_map[uid]:
            following_posts.append(pid)
        else:
            discovery_posts.append(pid)
            
    # Chọn ra tập tương tác (High Intent)
    n_inter = int(np.random.normal(AVG_INTERACTIONS, 5))
    n_inter = max(5, n_inter)
    
    # Mix theo tỷ lệ FOLLOW_BIAS
    n_follow = int(n_inter * FOLLOW_BIAS)
    n_discovery = n_inter - n_follow
    
    final_posts = following_posts[:n_follow] + discovery_posts[:n_discovery]
    random.shuffle(final_posts)
    
    # Chia Train/Test (80/20)
    split = int(len(final_posts) * 0.8)
    train_items = final_posts[:split]
    test_items = final_posts[split:]
    
    # Ghi Train (LIKE/REPLY/VIEW)
    for pid in train_items:
        base_time = get_random_timestamp()
        # 80% LIKE, 20% REPLY
        act_type = "REPLY_POST" if random.random() < 0.2 else "LIKE"
        
        train_data.append({
            "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
            "type": act_type, "createdAt": base_time.isoformat(),
            "dwellTime": None, "searchText": None
        })
        
        # Kèm theo 1 VIEW
        train_data.append({
            "id": str(uuid.uuid4()), "userId": uid, "postId": pid,
            "type": "POST_VIEW", "createdAt": (base_time - datetime.timedelta(seconds=30)).isoformat(),
            "dwellTime": random.randint(5000, 15000), "searchText": None
        })

    # Ghi Test
    for pid in test_items:
        test_data.append({"userId": uid, "postId": pid})
        
    # Thêm SEARCH hành vi (Quan trọng cho CBF)
    # Nếu user thuộc nhóm Tech (dựa trên Vector), cho họ search "React"
    # Ta check lại vector U[i]
    keywords_to_search = vector_to_text(U_matrix[i], type="user").split(" | ") # Lấy lại keywords từ vector
    if random.random() < 0.3: # 30% user có search
        term = random.choice(TOPICS["TECH"]["keywords"]) # Demo lấy random từ pool tương ứng
        # (Logic lấy đúng topic hơi dài dòng, ta random đơn giản trong phạm vi dataset)
        train_data.append({
            "id": str(uuid.uuid4()), "userId": uid, "postId": None,
            "type": "SEARCH", "createdAt": get_random_timestamp().isoformat(),
            "dwellTime": None, "searchText": "Tìm kiếm về công nghệ" # Placeholder
        })

# Sắp xếp theo thời gian
df_train = pd.DataFrame(train_data).sort_values("createdAt")
df_train.to_csv(f"{DATA_PATH}/train_interactions.csv", index=False)
pd.DataFrame(test_data).to_csv(f"{DATA_PATH}/test_interactions.csv", index=False)

print(f"\n✅ HOÀN TẤT! Dữ liệu đã lưu tại: {DATA_PATH}")
print("1. Chạy: python generate_dataset_unified.py")
print("2. Sửa ingest.ts: const DATA_PATH = './data_synthetic_unified'")
print("3. Chạy ingest -> predict -> evaluate.")

# Normalize cosine formula 
# $$Similarity = \frac{Overlap}{\sqrt{|A| \times |B|}}$$
# Feed được đánh giá:      cf
# Số user được đánh giá: 10000
# Mean Precision@10:     19.12%
# Mean Recall@10:        73.22%
# MAP@10:                48.88%

# Công thức chế biến linh tinh
# $$Score = \frac{Overlap}{\sqrt{Overlap \times |A|}} = \sqrt{\frac{Overlap}{|A|}}$$
# Feed được đánh giá:      cf
# Số user được đánh giá: 10000
# Mean Precision@10:     19.58%
# Mean Recall@10:        75.09%
# MAP@10:                49.28%