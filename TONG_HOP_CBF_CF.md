# Tổng Hợp Thuật Toán CBF và CF

Tài liệu này tổng hợp cách chạy code và phương pháp tính toán của Content-Based Filtering (CBF) và Collaborative Filtering (CF) trong hệ thống recommendation.

---

## 1. CONTENT-BASED FILTERING (CBF)

### 1.1. Cách Chạy Code

**Entry Point:**
```typescript
// File: recommendation.service.ts
async getRecommendations_CBF(userId: string, query: QueryRecommendationDto)
```

**Flow chính:**
1. Kiểm tra cache Redis (cache key: `recommendations:cbf:${userId}:${page}:${limit}`)
2. Gọi `getCBFCandidates(userId, poolLimit)` để lấy danh sách candidates
3. Áp dụng diversity filter
4. Pagination và cache kết quả

### 1.2. Quy Trình CBF

#### Bước 1: Thu thập User Signals

**1.1. Long-term Vector (Từ Persona)**
- Lấy từ Qdrant collection `userCollectionName` với `type: 'long-term-interest'`
- Đại diện cho sở thích dài hạn của user

**1.2. Short-term Vector (Từ Recent Interactions)**
- Lấy từ Qdrant collection `userShortTermCollectionName` với `type: 'short-term-preference'`
- Đại diện cho sở thích ngắn hạn (30 ngày gần nhất)

**1.3. Recent Interactions Profile (30 ngày)**
- Lấy các interactions HIGH INTENT trong 30 ngày:
  - LIKE, SHARE, REPLY_POST, POST_CLICK
  - POST_VIEW với dwellTime > threshold
- Giới hạn: 50 interactions
- Tính weighted average vector:
  ```
  V_recent = Σ(V_post_i × w_interaction_i × w_recency_i) / Σ(w_interaction_i × w_recency_i)
  ```
- Normalize về unit vector

**1.4. Category Preferences**
- Phân tích categories từ posts đã tương tác (30 ngày)
- Tính điểm cho mỗi category:
  ```
  category_score = Σ(interaction_weight × recency_weight)
  ```
- Normalize về [0, 1]

**1.5. Author Preferences**
- Phân tích authors từ posts đã tương tác (30 ngày)
- Tính điểm cho mỗi author tương tự category preferences
- Normalize về [0, 1]

#### Bước 2: Vector Similarity Search

- Sử dụng `userInterestVector` (combined) hoặc `recentInteractionsProfile` làm query vector
- Tìm top 800 candidates từ Qdrant (expanded pool để có đủ diversity)
- Loại trừ:
  - Posts của chính user
  - Posts đã tương tác (LIKE, SHARE, REPLY_POST)

#### Bước 3: Multi-Signal Scoring

Tính điểm cho mỗi candidate post với công thức:

```
Final_Score = w_vector × Vector_Score + 
              w_recent × Recent_Score + 
              w_category × Category_Score + 
              w_author × Author_Score + 
              w_time × Time_Decay + 
              Recency_Bonus + 
              Category_Boost + 
              Author_Boost
```

**Chi tiết từng thành phần:**

**3.1. Vector Score (40%)**
- **Dual Vector Strategy:**
  - Nếu có cả long-term và short-term:
    ```
    longTermScore = cosine_similarity(longTermVector, postVector)
    shortTermScore = cosine_similarity(shortTermVector, postVector)
    vectorScore = 0.45 × longTermScore + 0.35 × shortTermScore
    ```
  - Nếu chỉ có 1 vector: dùng vector đó
- **Fallback:** Nếu không có dual vectors, dùng `userInterestVector`

**3.2. Recent Score (30%)**
```
recentScore = cosine_similarity(recentInteractionsProfile, postVector)
```

**3.3. Category Score (20%)**
```
categoryScore = average(categoryPreferences[cat] for cat in post.categories)
```

**3.4. Author Score (10%)**
```
authorScore = authorPreferences[post.authorId] || 0
```

**3.5. Time Decay (10%)**
```
timeDecay = exp(-hoursDiff / (21 × 24))
```
- Posts cũ hơn sẽ có điểm thấp hơn (exponential decay với 21 ngày half-life)

**3.6. Recency Bonus**
- Post < 24h: +0.1
- Post < 7 ngày: +0.05

**3.7. Category Boost**
- Nếu `categoryScore > 0.3`: `+categoryScore × 0.15`

**3.8. Author Boost**
- Nếu `authorScore > 0.3`: `+authorScore × 0.1`

**Dynamic Weight Adjustment (Cold Start):**
- **Full signals:** Default weights (40% vector, 30% recent, 20% category, 10% author)
- **No recent profile:** Vector 70%, Category 25%, Author 5%
- **No vector signals:** Recent 60%, Category 30%, Author 10%
- **No interactions:** Vector 55%, Recent 45%

#### Bước 4: Extended Interactions Profile (Cold Start Handling)

Nếu không có interactions trong 30 ngày, mở rộng sang 90 ngày:
- Time window: 90 ngày
- Giới hạn: 30 interactions (thay vì 50)
- Interaction weights giảm 25%:
  - LIKE: 0.15 (thay vì 0.2)
  - SHARE: 0.25 (thay vì 0.35)
  - REPLY_POST: 0.3 (thay vì 0.4)
- Recency weights:
  - 30-60 ngày: 0.5
  - 60-90 ngày: 0.3

#### Bước 5: Diversity Filter

- Top 10: Max 3 posts/author, max 4 posts/category
- Còn lại: Max 4 posts/author, max 6 posts/category

---

## 2. COLLABORATIVE FILTERING (CF)

### 2.1. Cách Chạy Code

**Entry Point:**
```typescript
// File: recommendation.service.ts
async getRecommendations_CF(userId: string, query: QueryRecommendationDto)
```

**Flow chính:**
1. Kiểm tra cache Redis (cache key: `recommendation:cf:${userId}:${page}:${limit}`)
2. Gọi `getCFCandidatesAsPost(userId, poolLimit)` để lấy danh sách candidates
3. Sort và pagination
4. Cache kết quả

### 2.2. Quy Trình CF

#### Bước 1: Lấy High Intent Interactions của User

Lấy các interactions trong 30 ngày gần nhất:
- LIKE, SHARE, POST_CLICK
- REPLY_POST (từ posts user đã reply)
- POST_VIEW với dwellTime > threshold

**Chi tiết:**
- Time window: 30 ngày
- Loại bỏ duplicates (giữ interaction mới nhất)

#### Bước 2: Tìm Similar Users (Weighted Jaccard Similarity)

**2.1. Weighted Jaccard Similarity Formula:**
```
similarity(A, B) = weighted_intersection(A, B) / weighted_union(A, B)
```

**2.2. Tính Weighted Intersection:**
```
for each post mà cả 2 users đều tương tác:
  myWeight = interaction_weight(myType) × recency_weight(myDaysAgo)
  theirWeight = interaction_weight(theirType) × recency_weight(theirDaysAgo)
  weightedIntersection += min(myWeight, theirWeight)
```

**2.3. Tính Weighted Union:**
```
myWeightedSum = Σ(interaction_weight(type) × recency_weight(daysAgo)) for my interactions
theirWeightedSum = Σ(interaction_weight(type) × recency_weight(daysAgo)) for their interactions
weightedUnion = myWeightedSum + theirWeightedSum - weightedIntersection
```

**2.4. Interaction Weights:**
- REPLY_POST: 0.4
- SHARE: 0.35
- LIKE: 0.2
- POST_CLICK: 0.1
- POST_VIEW: 0.05

**2.5. Recency Weights:**
- 0-7 ngày: 1.0
- 8-14 ngày: 0.8
- 15-21 ngày: 0.6
- 22-30 ngày: 0.4
- > 30 ngày: 0.2

**2.6. Filter Similar Users:**
- Similarity > 0.03
- Minimum 2 overlaps
- Return top 50 similar users

**Ví dụ tính toán:**
- User A: Liked P1 (7 ngày trước, weight: 0.2 × 1.0 = 0.2), Shared P2 (3 ngày trước, weight: 0.35 × 1.0 = 0.35)
- User B: Liked P1 (5 ngày trước, weight: 0.2 × 1.0 = 0.2), Clicked P3 (10 ngày trước, weight: 0.1 × 0.8 = 0.08)

- Weighted Intersection: min(0.2, 0.2) = 0.2 (chỉ P1 overlap)
- Weighted Union: (0.2 + 0.35) + (0.2 + 0.08) - 0.2 = 0.63
- Similarity: 0.2 / 0.63 = 0.317

#### Bước 3: Lấy Candidate Posts từ Similar Users

- Lấy các posts mà similar users đã tương tác (không bao gồm posts user đã tương tác)
- Expanded pool limit: 500 posts
- Group by postId và lưu interactions (userId, type, createdAt, similarity)

#### Bước 4: Multi-Signal Scoring

Tính điểm cho mỗi candidate post:

```
Final_Score = 0.45 × Similarity_Score + 
              0.30 × Quality_Score + 
              0.15 × Recency_Score + 
              0.10 × Popularity_Score + 
              0.10 × Time_Decay + 
              Recency_Bonus
```

**Chi tiết từng thành phần:**

**4.1. Similarity Score (45%)**
- Weighted average similarity của users tương tác với post:
```
totalSimilarity = Σ(similarity_i × similarity_i)  // Weighted by similarity^2
totalWeight = Σ(similarity_i)
similarityScore = totalSimilarity / totalWeight
```

**4.2. Quality Score (30%)**
- Kết hợp interaction quality và recency:
```
weightedSum = Σ(interaction_weight(type) × recency_weight(daysAgo) × similarity)
qualityScore = weightedSum / interactions.length
```

**4.3. Recency Score (15%)**
```
recencySum = Σ(recency_decay(daysAgo) × similarity)
recencyScore = recencySum / interactions.length
```

**4.4. Popularity Score (10%)**
```
uniqueSimilarUsers = số lượng unique users tương tác với post
totalSimilarUsers = tổng số similar users
popularityScore = log(1 + uniqueSimilarUsers) / log(1 + totalSimilarUsers)
```

**4.5. Time Decay (10%)**
```
timeDecay = exp(-hoursDiff / (21 × 24))
```

**4.6. Recency Bonus**
- Post < 24h: +0.1
- Post < 7 ngày: +0.05

#### Bước 5: Diversity Filter

- Áp dụng tương tự CBF
- Top 10: Max 3 posts/author, max 4 posts/category
- Còn lại: Max 4 posts/author, max 6 posts/category

---

## 3. CÁC HÀM TIỆN ÍCH CHUNG

### 3.1. Interaction Weight
```typescript
_getInteractionWeight(type: string): number
```
- REPLY_POST: 0.4
- SHARE: 0.35
- LIKE: 0.2
- POST_CLICK: 0.1
- POST_VIEW: 0.05

### 3.2. Recency Weight
```typescript
_getRecencyWeight(daysAgo: number): number
```
- 0-7 ngày: 1.0
- 8-14 ngày: 0.8
- 15-21 ngày: 0.6
- 22-30 ngày: 0.4
- > 30 ngày: 0.2

### 3.3. Recency Decay
```typescript
_getRecencyDecay(daysAgo: number): number
```
- 0-1 ngày: 1.0
- 2-7 ngày: 0.8
- 8-14 ngày: 0.6
- 15-30 ngày: 0.4
- > 30 ngày: 0.2

### 3.4. Time Decay Score
```typescript
_calculateTimeDecayScore(post: Post): number
```
```
timeDecay = exp(-hoursDiff / (21 × 24))
```
- Exponential decay với half-life 21 ngày

### 3.5. Cosine Similarity
```typescript
_cosineSimilarity(vecA: number[], vecB: number[]): number
```
```
cosine_similarity = (A · B) / (||A|| × ||B||)
```

---

## 4. SO SÁNH CBF VÀ CF

| Tiêu chí | CBF | CF |
|----------|-----|-----|
| **Dữ liệu đầu vào** | User vectors, interactions, categories, authors | User interactions, similar users |
| **Phương pháp** | Content similarity (vector-based) | User-user similarity (behavior-based) |
| **Điểm mạnh** | Không phụ thuộc vào user khác, giải quyết cold-start tốt hơn | Phát hiện patterns ẩn, đa dạng hơn |
| **Điểm yếu** | Thiếu tính đa dạng, khó phát hiện trends mới | Cold-start problem, cần nhiều data |
| **Tính toán chính** | Cosine similarity với embeddings | Weighted Jaccard similarity |
| **Signals sử dụng** | Vector, Recent, Category, Author, Time | Similarity, Quality, Recency, Popularity, Time |

---

## 5. LƯU Ý QUAN TRỌNG

1. **Cache Strategy:**
   - CBF và CF đều cache kết quả trong Redis với TTL 30 phút
   - Cache key format: `recommendations:{type}:{userId}:{page}:{limit}`

2. **Cold Start Handling:**
   - CBF: Extended interactions profile (90 ngày), fallback to popular posts
   - CF: Return empty nếu không có similar users hoặc interactions

3. **Diversity:**
   - Cả 2 đều áp dụng diversity filter để tránh quá nhiều posts từ cùng author/category
   - Giới hạn khác nhau cho top 10 và phần còn lại

4. **Vector Strategy:**
   - CBF sử dụng dual vector strategy (long-term + short-term)
   - Dynamic weights dựa trên số lượng interactions

5. **Scoring Formula:**
   - Cả 2 đều sử dụng multi-signal scoring với weights động
   - Adjust weights khi thiếu signals (cold start scenarios)

