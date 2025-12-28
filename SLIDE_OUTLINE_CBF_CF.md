# Slide Outline - CBF và CF Algorithms

File này mô tả nội dung và cấu trúc của các slide về thuật toán CBF và CF để hỗ trợ việc thiết kế slide thuyết trình.

---

## Slide 9: Content-Based Filtering (CBF) - Thuật Toán

### Tiêu đề chính:
**Content-Based Filtering (CBF) - Thuật Toán**

### Nội dung slide:

#### Phần 1: Nguyên tắc hoạt động
- **Header:** "Nguyên tắc: Nếu bạn thích A, bạn sẽ thích những nội dung tương tự A"
- Icon/Bullet point

#### Phần 2: 5 Loại Tín Hiệu (User Signals)

**1. Long-term Vector**
- Nguồn: Persona từ đăng ký
- Đặc điểm: Sở thích cốt lõi, ổn định
- Icon: Timeline/Long-term icon

**2. Short-term Vector**
- Nguồn: Tương tác 30 ngày gần nhất
- Đặc điểm: Xu hướng tạm thời, động
- Icon: Clock/Recent icon

**3. Recent Interactions Profile**
- Số lượng: 50 bài viết gần nhất
- Trọng số tương tác: Reply (0.4), Share (0.35), Like (0.2)
- Trọng số thời gian: 7 ngày đầu (1.0), giảm dần
- Icon: Chart/Vector icon

**4. Category Preferences**
- Phân tích chủ đề quan tâm
- Điểm số: 0-1 cho mỗi category
- Icon: Tags/Categories icon

**5. Author Preferences**
- Phân tích tác giả thường tương tác
- Điểm số: 0-1 cho mỗi author
- Icon: Users/Author icon

#### Phần 3: Vector Similarity Search
- Sử dụng Qdrant
- Top 100 candidates
- Loại trừ: Posts của user, posts đã tương tác

### Visual Elements:
- Sơ đồ flow: Signals → Vector Search → Candidates
- Icons cho mỗi loại signal
- Color coding: Màu khác nhau cho từng signal type

---

## Slide 10: CBF - Multi-Signal Scoring Formula

### Tiêu đề chính:
**CBF - Multi-Signal Scoring Formula**

### Nội dung slide:

#### Phần 1: Công thức tổng quát
```
Final Score = w_vector × Vector_Score + 
              w_recent × Recent_Score + 
              w_category × Category_Score + 
              w_author × Author_Score + 
              w_time × Time_Decay + 
              Bonuses
```

#### Phần 2: Chi tiết từng thành phần (Có thể dùng chart/donut chart)

**Vector Score (40%)**
- Dual Vector Strategy
  - Long-term: 45% weight
  - Short-term: 35% weight
- Visual: Bar chart hoặc pie chart nhỏ

**Recent Score (30%)**
- Cosine similarity với recent profile
- Icon: Clock

**Category Score (20%)**
- Average category preferences
- Icon: Tags

**Author Score (10%)**
- Author preference value
- Icon: User

**Time Decay (10%)**
- Exponential decay
- Half-life: 21 ngày
- Formula: exp(-hoursDiff / (21 × 24))
- Visual: Decay curve graph

#### Phần 3: Bonuses & Boosts
- Recency Bonus: < 24h (+0.1), < 7 days (+0.05)
- Category Boost: Nếu score > 0.3, +score × 0.15
- Author Boost: Nếu score > 0.3, +score × 0.1

#### Phần 4: Dynamic Weight Adjustment
- Flow chart: Full signals → Default weights
- Missing signals → Adjusted weights
- Cold start handling

### Visual Elements:
- Pie chart hoặc stacked bar chart cho weight distribution
- Decay curve cho time decay
- Color-coded formula
- Flow diagram cho dynamic adjustment

---

## Slide 11: Collaborative Filtering (CF) - Thuật Toán

### Tiêu đề chính:
**Collaborative Filtering (CF) - Thuật Toán**

### Nội dung slide:

#### Phần 1: Nguyên tắc
- **Header:** "Những người có hành vi tương tự sẽ có sở thích tương tự"
- Icon: Users/Community icon

#### Phần 2: Quy trình 4 bước (Flow diagram)

**Bước 1: Thu thập Interactions**
- High Intent Interactions (30 ngày)
- Types: Like, Share, Click, Reply, View (high dwell time)
- Icon: Collection/Data icon

**Bước 2: Tìm Similar Users**
- Phương pháp: Weighted Jaccard Similarity
- Top 50 users
- Threshold: similarity > 0.03, min 2 overlaps
- Icon: Network/Graph icon

**Bước 3: Lấy Candidate Posts**
- Từ similar users (500 candidates)
- Loại trừ: Posts user đã tương tác
- Icon: Posts/Documents icon

**Bước 4: Multi-Signal Scoring**
- Tính điểm cho mỗi candidate
- Icon: Calculator/Score icon

#### Phần 3: Weighted Jaccard - Key Points
- Khác với Jaccard truyền thống
- Tính đến: Loại tương tác, Độ mới
- Interaction weights: Reply (0.4), Share (0.35), Like (0.2), Click (0.1), View (0.05)
- Recency weights: 0-7d (1.0), 8-14d (0.8), 15-21d (0.6), 22-30d (0.4)

#### Phần 4: Điểm mạnh CF
- Phát hiện patterns ẩn
- Ví dụ: "Điện ảnh" → "Công nghệ" (từ cộng đồng)
- Visual: Connection diagram

### Visual Elements:
- Flow diagram 4 bước (có thể dùng numbered steps)
- Network graph cho similar users
- Table cho interaction weights và recency weights
- Example visualization

---

## Slide 12: CF - Weighted Jaccard Similarity & Scoring

### Tiêu đề chính:
**CF - Weighted Jaccard Similarity & Scoring**

### Nội dung slide:

#### Phần 1: Công thức Weighted Jaccard
```
Similarity(A, B) = Weighted_Intersection(A, B) / Weighted_Union(A, B)
```

#### Phần 2: Ví dụ tính toán (Step-by-step)

**Scenario:**
- User A: Like P1 (7d ago), Share P2 (3d ago)
- User B: Like P1 (5d ago), Click P3 (10d ago)

**Step 1: Tính weights**
- User A, P1: 0.2 × 1.0 = 0.2
- User A, P2: 0.35 × 1.0 = 0.35
- User B, P1: 0.2 × 1.0 = 0.2
- User B, P3: 0.1 × 0.8 = 0.08

**Step 2: Weighted Intersection**
- Overlap: P1
- min(0.2, 0.2) = 0.2

**Step 3: Weighted Union**
- User A sum: 0.2 + 0.35 = 0.55
- User B sum: 0.2 + 0.08 = 0.28
- Union: 0.55 + 0.28 - 0.2 = 0.63

**Step 4: Similarity**
- 0.2 / 0.63 = 0.317 (31.7%)

#### Phần 3: Multi-Signal Scoring Formula

```
Final_Score = 0.45 × Similarity_Score + 
              0.30 × Quality_Score + 
              0.15 × Recency_Score + 
              0.10 × Popularity_Score + 
              0.10 × Time_Decay + 
              Recency_Bonus
```

**Chi tiết từng thành phần:**

**Similarity Score (45%)**
- Weighted average (similarity²)
- Highest weight component

**Quality Score (30%)**
- Interaction weight × Recency weight × User similarity

**Recency Score (15%)**
- Recency decay × User similarity

**Popularity Score (10%)**
- Log scale: log(1 + unique users) / log(1 + total users)

**Time Decay (10%)**
- Exponential decay (21 days half-life)

### Visual Elements:
- Step-by-step calculation table
- Formula với color coding
- Bar chart cho weight distribution
- Example calculation visualization

---

## Slide 13: So Sánh CBF vs CF & Kết Luận

### Tiêu đề chính:
**So Sánh CBF vs CF & Kết Luận**

### Nội dung slide:

#### Phần 1: Bảng So Sánh (Comparison Table)

| Tiêu chí | CBF | CF |
|----------|-----|-----|
| **Điểm mạnh** | • Không phụ thuộc users khác<br>• Giải quyết cold-start tốt<br>• Cá nhân hóa cao | • Phát hiện patterns ẩn<br>• Đa dạng hơn<br>• Phản ánh xu hướng cộng đồng |
| **Điểm yếu** | • Thiếu đa dạng<br>• Khó phát hiện trends mới | • Cold-start problem<br>• Cần nhiều data<br>• Khó giải thích |
| **Phương pháp** | Content similarity<br>(Vector-based) | User similarity<br>(Behavior-based) |
| **Tín hiệu** | Vector, Recent,<br>Category, Author, Time | Similarity, Quality,<br>Recency, Popularity, Time |

#### Phần 2: Hybrid Approach

**Kết hợp CBF và CF:**
- Lấy top 100 từ mỗi phương pháp
- Interleave (xen kẽ) với trọng số động
- Dựa trên chất lượng của mỗi pool
- Visual: Venn diagram hoặc combination diagram

**Benefits:**
- Tận dụng ưu điểm cả hai
- Giảm thiểu nhược điểm
- Cân bằng cá nhân hóa và đa dạng

#### Phần 3: Diversity Filter
- Áp dụng cho cả CBF và CF
- Top 10: Max 3 posts/author, max 4 posts/category
- Còn lại: Max 4 posts/author, max 6 posts/category
- Đảm bảo trải nghiệm phong phú

#### Phần 4: Tối ưu hiệu năng
- Cache trong Redis (TTL: 30 phút)
- Log recommendations để phân tích
- Continuous improvement

#### Phần 5: Kết luận
- Hai thuật toán bổ trợ cho nhau
- Hybrid approach tối ưu
- Hệ thống linh hoạt và có thể mở rộng

### Visual Elements:
- Comparison table với color coding
- Venn diagram cho hybrid approach
- Icon summary cho mỗi phương pháp
- Final summary graphic

---

## Slide 14: Hybrid Recommendation System

### Tiêu đề chính:
**Hybrid Recommendation System**

### Nội dung slide:

#### Phần 1: Overview
- **Header:** "Kết hợp CBF, CF và Popular Posts"
- Icon: Combination/Integration icon
- Brief explanation về hybrid approach

#### Phần 2: Quy Trình 3 Giai Đoạn (Flow diagram)

**Giai đoạn 1: Parallel Candidate Generation**
- **CBF Pool**: Top 100 candidates
  - Icon: Vector/Magnifying glass
  - Source: Content similarity
- **CF Pool**: Top 100 candidates
  - Icon: Users/Network
  - Source: Similar users
- **Popular Pool**: Top 100 posts
  - Icon: Trending/Fire
  - Source: Engagement metrics
- Visual: 3 parallel arrows converging

**Giai đoạn 2: Dynamic Weight Calculation**
- Formula visualization:
  ```
  CBF Weight = min(pool.length / 50, 1.0)
  CF Weight = min(pool.length / 50, 1.0)
  Popular Weight = 0.2 (fixed)
  ```
- Normalize weights to sum = 1
- Visual: Bar chart showing weight distribution

**Giai đoạn 3: Weighted Interleaving**
- Algorithm explanation
- Priority-based selection
- Duplicate removal
- Visual: Interleaving diagram

#### Phần 3: Ví Dụ Cụ Thể
- Scenario: User với nhiều interactions
- Weights: CBF 40%, CF 40%, Popular 20%
- Visual: Pie chart hoặc stacked bar

#### Phần 4: Xử Lý Edge Cases
- **Cold Start Handling:**
  - Fallback to popular posts
  - Sorted by engagement metrics
- **Diversity Filter:**
  - Max posts per author/category
  - Ensures variety

#### Phần 5: Benefits
- Leverage strengths of both CBF and CF
- Minimize weaknesses
- Balance personalization and diversity
- Visual: Summary icons

#### Phần 6: Performance Optimization
- Cache in Redis (TTL: 30 minutes)
- Logging for analysis
- Continuous improvement

### Visual Elements:
- Flow diagram cho 3 giai đoạn
- Bar chart cho dynamic weights
- Pie chart cho weight distribution
- Interleaving visualization
- Benefits summary icons

---

## Design Guidelines

### Màu sắc đề xuất:
- **CBF**: Blue tones (ổn định, cá nhân hóa)
- **CF**: Green/Orange tones (cộng đồng, đa dạng)
- **Hybrid**: Purple/Gradient (kết hợp)
- **Popular**: Red/Orange tones (trending)

### Font & Typography:
- Tiêu đề: Bold, size lớn (24-32pt)
- Nội dung: Regular, readable (14-18pt)
- Code/Formula: Monospace font

### Layout:
- Consistent spacing
- Grid layout cho tables
- Visual hierarchy rõ ràng
- Icons và illustrations để hỗ trợ

### Animations (nếu có):
- Slide 10: Reveal từng phần của formula
- Slide 11: Step-by-step flow animation
- Slide 12: Highlight calculation steps
- Slide 13: Comparison table reveal
- Slide 14: Sequential reveal của 3 giai đoạn

---

## Slide 15: Evaluation & Results - Offline Evaluation

### Tiêu đề chính:
**Evaluation & Results - Offline Evaluation**

### Nội dung slide:

#### Phần 1: Quy Trình Offline Evaluation (Flow diagram)
1. **Data Generation** → Tạo dữ liệu giả lập
2. **Train/Test Split** → Chia 80/20 theo thời gian
3. **Predict** → Tạo recommendations
4. **Evaluate** → So sánh với ground truth

#### Phần 2: Tạo Dữ Liệu Giả Lập

**Dataset Composition:**
- 2,000 users (Power 5%, Casual 70%, New 25%)
- 10,000 posts (12 categories)
- 300,000+ interactions
- Visual: Pie chart cho user distribution

**Cách Tạo Interactions:**
- Interest Match Rate (75-85%): Posts từ chủ đề yêu thích
- Viral Click Rate (20-40%): Posts phổ biến
- Engagement Rate (15-40%): View → Like/Share/Reply
- 10% Noise: Interactions ngẫu nhiên
- Visual: Flow diagram cho interaction generation

#### Phần 3: Train/Test Split

**Time-based Split (80/20):**
- Training Set: 80% interactions cũ hơn
  - Xây dựng user profiles
  - Training models
- Test Set: 20% interactions mới hơn
  - Ground truth cho evaluation
  - Ẩn đi khi tạo recommendations
- Visual: Timeline diagram

#### Phần 4: Evaluation Metrics

**Accuracy Metrics:**
- Precision@K: Tỷ lệ recommendations đúng
- Recall@K: Tỷ lệ ground truth được tìm thấy
- MAP@K: Mean Average Precision (ranking quality)
- NDCG@K: Normalized Discounted Cumulative Gain

**Quality Metrics:**
- Diversity: Đa dạng về categories/authors
- Coverage: Tỷ lệ items được recommend
- Visual: Table hoặc bar chart

#### Phần 5: Kết Quả

**Cold-start Users:**
- Hybrid: P@10=0.387, R@10=0.234, MAP@10=0.341
- vs Pure CF: 0.182 / 0.095 / 0.156
- vs Pure CBF: 0.312 / 0.187 / 0.267
- Visual: Comparison bar chart

**Active Users:**
- Hybrid: P@10=0.523, R@10=0.387, MAP@10=0.476
- Diversity: 0.64 (highest)
- Visual: Comparison bar chart

**Overall Performance:**
- Hybrid: Best across all metrics
- Response time: 432ms (acceptable)
- Cache hit rate: 75.8% (highest)
- Visual: Summary table

#### Phần 6: Kết Luận

- Hybrid outperforms cả CBF và CF
- Best accuracy, coverage, và diversity
- Acceptable latency với high cache hit rate

### Visual Elements:
- Flow diagram cho evaluation process
- Pie chart cho user distribution
- Timeline cho train/test split
- Bar charts cho comparison metrics
- Summary table cho overall results

### Design Notes:
- Use consistent color scheme với các slides trước
- Highlight Hybrid results với accent color
- Clear visual hierarchy để dễ đọc metrics

