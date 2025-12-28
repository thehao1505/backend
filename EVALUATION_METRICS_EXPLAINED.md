# Giải Thích Chi Tiết Các Metrics Trong Evaluation

File `evaluate.ts` sử dụng các metrics để đánh giá chất lượng hệ thống recommendation. Dưới đây là giải thích chi tiết từng metric.

---

## 📋 **CÁC THAM SỐ CẤU HÌNH**

### 1. **K (Top-K)**
- **Định nghĩa**: Số lượng items được recommend cho mỗi user (ví dụ: K=10 nghĩa là top 10 recommendations)
- **Giá trị mặc định**: 10 (có thể cấu hình trong `config.ts`)
- **Ý nghĩa**: 
  - Metrics được tính trên K items đầu tiên trong danh sách recommendation
  - K càng lớn → recall cao hơn nhưng precision có thể giảm
  - K càng nhỏ → precision cao hơn nhưng có thể bỏ sót items quan trọng

### 2. **SOURCE_TO_EVALUATE**
- **Định nghĩa**: Nguồn recommendation cần đánh giá (cbf, cf, hybrid, following, etc.)
- **Giá trị mặc định**: 'hybrid'
- **Ý nghĩa**: Chỉ đánh giá recommendations từ source này trong RecommendationLog

### 3. **TEST_INTERACTIONS_FILE**
- **Định nghĩa**: File CSV chứa ground truth (đáp án đúng)
- **Đường dẫn**: `./data_offline_eval/test_interactions.csv`
- **Format**: `userId,postId`
- **Ý nghĩa**: Dữ liệu test set - các interactions thực tế của users (được giữ lại từ train/test split)

---

## 🎯 **METRICS CHÍNH (Accuracy Metrics)**

### 1. **Precision@K (P@K)**

**Định nghĩa**: Tỷ lệ items được recommend mà thực sự relevant trong top K recommendations.

**Công thức**:
```
P@K = (Số items relevant trong top K) / K
```

**Ví dụ**:
- Recommendations: [A, B, C, D, E] (top 5)
- Ground Truth: {A, C, E, F}
- Relevant items trong top 5: A, C, E (3 items)
- **P@5 = 3/5 = 0.6 (60%)**

**Ý nghĩa**:
- ✅ **Cao (0.7-1.0)**: Hệ thống recommend chính xác, ít items không liên quan
- ⚠️ **Trung bình (0.3-0.7)**: Có một số items không liên quan
- ❌ **Thấp (<0.3)**: Nhiều items không liên quan được recommend

**Trong code** (dòng 51):
```typescript
const p_at_k = hits / K
```

---

### 2. **Recall@K (R@K)**

**Định nghĩa**: Tỷ lệ items relevant được tìm thấy trong top K recommendations.

**Công thức**:
```
R@K = (Số items relevant trong top K) / (Tổng số items relevant)
```

**Ví dụ**:
- Recommendations: [A, B, C, D, E] (top 5)
- Ground Truth: {A, C, E, F, G, H} (6 items relevant)
- Relevant items trong top 5: A, C, E (3 items)
- **R@5 = 3/6 = 0.5 (50%)**

**Ý nghĩa**:
- ✅ **Cao (0.7-1.0)**: Hệ thống tìm được hầu hết items relevant
- ⚠️ **Trung bình (0.3-0.7)**: Bỏ sót một số items relevant
- ❌ **Thấp (<0.3)**: Bỏ sót nhiều items relevant

**Trong code** (dòng 52):
```typescript
const r_at_k = hits / totalRelevantItems
```

**Trade-off với Precision**:
- Tăng K → Recall tăng (tìm được nhiều items hơn) nhưng Precision có thể giảm
- Giảm K → Precision tăng (chỉ recommend items tốt nhất) nhưng Recall giảm

---

### 3. **Average Precision@K (AP@K)**

**Định nghĩa**: Trung bình precision tại mỗi vị trí có relevant item.

**Công thức**:
```
AP@K = (1 / số items relevant) × Σ(Precision@i tại mỗi vị trí có relevant item)
```

**Ví dụ**:
- Recommendations: [A, B, C, D, E] (top 5)
- Ground Truth: {A, C, E}
- Relevant items: A (vị trí 1), C (vị trí 3), E (vị trí 5)
- Precision@1 = 1/1 = 1.0 (có 1 relevant trong 1 item đầu)
- Precision@3 = 2/3 = 0.67 (có 2 relevant trong 3 items đầu)
- Precision@5 = 3/5 = 0.6 (có 3 relevant trong 5 items đầu)
- **AP@5 = (1.0 + 0.67 + 0.6) / 3 = 0.76**

**Ý nghĩa**:
- ✅ **Cao (0.7-1.0)**: Relevant items xuất hiện sớm trong danh sách
- ⚠️ **Trung bình (0.3-0.7)**: Relevant items xuất hiện ở giữa danh sách
- ❌ **Thấp (<0.3)**: Relevant items xuất hiện muộn hoặc không có

**Trong code** (dòng 40-41, 53):
```typescript
if (isRelevant) {
  hits++
  const precision_at_k_plus_1 = hits / (k + 1)
  precisionSum += precision_at_k_plus_1
}
const ap_at_k = precisionSum / totalRelevantItems
```

**Ưu điểm**: AP@K vừa đo precision vừa đo ranking quality (items relevant có ở top không)

---

### 4. **Mean Average Precision@K (MAP@K)**

**Định nghĩa**: Trung bình AP@K của tất cả users.

**Công thức**:
```
MAP@K = (1 / số users) × Σ(AP@K của mỗi user)
```

**Ví dụ**:
- User 1: AP@10 = 0.8
- User 2: AP@10 = 0.6
- User 3: AP@10 = 0.9
- **MAP@10 = (0.8 + 0.6 + 0.9) / 3 = 0.77**

**Ý nghĩa**: Metric tổng hợp để đánh giá chất lượng recommendation trên toàn bộ users.

**Trong code** (dòng 264):
```typescript
const MAP = mean(metrics.averagePrecisionAtK)
```

---

### 5. **NDCG@K (Normalized Discounted Cumulative Gain@K)**

**Định nghĩa**: Đo chất lượng ranking với discount factor cho vị trí thấp hơn.

**Công thức**:
```
DCG@K = Σ(relevance_i / log2(i + 1))  với i từ 1 đến K
IDCG@K = DCG@K lý tưởng (tất cả relevant items ở top)
NDCG@K = DCG@K / IDCG@K
```

**Ví dụ**:
- Recommendations: [A(relevant), B(not), C(relevant), D(not), E(relevant)]
- DCG@5 = 1/log2(2) + 0/log2(3) + 1/log2(4) + 0/log2(5) + 1/log2(6)
       = 1/1 + 0 + 1/2 + 0 + 1/2.58 = 1 + 0.5 + 0.39 = 1.89
- IDCG@5 (nếu tất cả relevant ở top): 1/1 + 1/1.58 + 1/2 = 1 + 0.63 + 0.5 = 2.13
- **NDCG@5 = 1.89 / 2.13 = 0.89**

**Ý nghĩa**:
- ✅ **Cao (0.7-1.0)**: Ranking tốt, relevant items ở top
- ⚠️ **Trung bình (0.3-0.7)**: Relevant items ở giữa danh sách
- ❌ **Thấp (<0.3)**: Relevant items ở cuối hoặc không có

**Trong code** (dòng 46, 56-60):
```typescript
// DCG
dcg += isRelevant / Math.log2(k + 2)

// IDCG (ideal)
for (let i = 0; i < Math.min(totalRelevantItems, K); i++) {
  idcg += 1 / Math.log2(i + 2)
}
const ndcg_at_k = idcg > 0 ? dcg / idcg : 0
```

**Ưu điểm**: 
- Penalize items relevant xuất hiện muộn (vị trí càng thấp, giá trị càng nhỏ)
- Normalized về [0, 1] để so sánh giữa các users

---

## 📊 **METRICS BỔ SUNG (Beyond Accuracy)**

### 6. **Coverage (Ground Truth Coverage)**

**Định nghĩa**: Tỷ lệ items trong ground truth được recommend ít nhất 1 lần.

**Công thức**:
```
Coverage = (Số items trong ground truth được recommend) / (Tổng số items trong ground truth) × 100%
```

**Ví dụ**:
- Ground Truth có 1000 unique items
- Có 750 items được recommend ít nhất 1 lần
- **Coverage = 750/1000 = 75%**

**Ý nghĩa**:
- ✅ **Cao (>70%)**: Hệ thống recommend được nhiều items khác nhau
- ⚠️ **Trung bình (40-70%)**: Một số items không được recommend
- ❌ **Thấp (<40%)**: Nhiều items không được recommend (có thể do cold-start hoặc bias)

**Trong code** (dòng 287-290):
```typescript
const coverage = allGroundTruthPostIds.size > 0
  ? (Array.from(allGroundTruthPostIds).filter(id => allRecommendedPostIds.has(id)).length / allGroundTruthPostIds.size) * 100
  : 0
```

**Vấn đề**: Coverage cao không có nghĩa là recommendation tốt (có thể recommend random items)

---

### 7. **Catalog Coverage**

**Định nghĩa**: Tỷ lệ unique items trong catalog được recommend.

**Công thức**:
```
Catalog Coverage = (Số unique items được recommend) / (Tổng số items trong catalog) × 100%
```

**Ví dụ**:
- Catalog có 10,000 posts
- Có 2,000 unique posts được recommend
- **Catalog Coverage = 2000/10000 = 20%**

**Ý nghĩa**:
- ✅ **Cao (>30%)**: Hệ thống recommend đa dạng, không chỉ focus vào popular items
- ⚠️ **Trung bình (10-30%)**: Có một số diversity
- ❌ **Thấp (<10%)**: Hệ thống chỉ recommend một số items nhất định (có thể là popular items)

**Trong code** (dòng 292-294):
```typescript
const totalPostsInCatalog = allPostIds.size
const catalogCoverage = totalPostsInCatalog > 0 ? (allRecommendedPostIds.size / totalPostsInCatalog) * 100 : 0
```

**Vấn đề**: 
- Coverage cao có thể do recommend random → precision thấp
- Cần balance giữa coverage và accuracy

---

### 8. **Diversity (Category Diversity)**

**Định nghĩa**: Độ đa dạng về categories trong recommendations của mỗi user.

**Công thức**:
```
Category Diversity = (Số unique categories) / min(số recommendations, 10)
```

**Ví dụ**:
- Recommendations có 10 posts
- Posts thuộc 7 categories khác nhau
- **Category Diversity = 7/10 = 0.7 (70%)**

**Ý nghĩa**:
- ✅ **Cao (>0.6)**: Recommendations đa dạng về topics
- ⚠️ **Trung bình (0.3-0.6)**: Có một số diversity
- ❌ **Thấp (<0.3)**: Recommendations tập trung vào một vài categories

**Trong code** (dòng 219-225, 234):
```typescript
const categories = new Set<string>()
predictions.forEach(postId => {
  const post = postsMap.get(postId)
  if (post && post.categories) {
    post.categories.forEach((cat: string) => categories.add(cat))
  }
})
const categoryDiversity = predictions.length > 0 ? categories.size / Math.min(predictions.length, 10) : 0
```

---

### 9. **Diversity (Author Diversity)**

**Định nghĩa**: Độ đa dạng về authors trong recommendations của mỗi user.

**Công thức**:
```
Author Diversity = (Số unique authors) / min(số recommendations, 10)
```

**Ví dụ**:
- Recommendations có 10 posts
- Posts từ 5 authors khác nhau
- **Author Diversity = 5/10 = 0.5 (50%)**

**Ý nghĩa**:
- ✅ **Cao (>0.6)**: Recommendations từ nhiều authors khác nhau
- ⚠️ **Trung bình (0.3-0.6)**: Có một số diversity
- ❌ **Thấp (<0.3)**: Recommendations tập trung vào một vài authors

**Trong code** (dòng 227-229, 235):
```typescript
if (post.author) {
  authors.add(post.author.toString())
}
const authorDiversity = predictions.length > 0 ? authors.size / Math.min(predictions.length, 10) : 0
```

**Mean Overall Diversity** (dòng 299):
```typescript
const meanDiversity = (meanCategoryDiversity + meanAuthorDiversity) / 2
```

---

## 📈 **THỐNG KÊ BỔ SUNG**

### 10. **Users With Hits**

**Định nghĩa**: Số lượng users có ít nhất 1 relevant item trong recommendations.

**Công thức**:
```
Users With Hits = Số users có Precision@K > 0
Users With Hits % = (Users With Hits / Users Evaluated) × 100%
```

**Ý nghĩa**:
- ✅ **Cao (>80%)**: Hầu hết users đều có ít nhất 1 item relevant
- ⚠️ **Trung bình (50-80%)**: Một số users không có hits
- ❌ **Thấp (<50%)**: Nhiều users không có hits (cold-start problem hoặc model kém)

**Trong code** (dòng 249-251):
```typescript
if (p_at_k > 0) {
  usersWithHits++
}
```

---

### 11. **Average Ground Truth Size**

**Định nghĩa**: Số lượng items relevant trung bình cho mỗi user trong test set.

**Công thức**:
```
Avg Ground Truth Size = Tổng số items trong tất cả ground truth / Số users
```

**Ý nghĩa**: 
- Cho biết độ phong phú của test set
- Ground truth size lớn → dễ đạt recall cao hơn

**Trong code** (dòng 268-269):
```typescript
const avgGroundTruthSize = groundTruthMap.size > 0 
  ? Array.from(groundTruthMap.values()).reduce((sum, set) => sum + set.size, 0) / groundTruthMap.size 
  : 0
```

---

### 12. **Average Recommendations Per User**

**Định nghĩa**: Số lượng recommendations trung bình cho mỗi user.

**Công thức**:
```
Avg Recommendations/User = Tổng số recommendations / Số users
```

**Ý nghĩa**: 
- Cho biết hệ thống recommend bao nhiêu items cho mỗi user
- Nếu < K → một số users không đủ recommendations

**Trong code** (dòng 271):
```typescript
const avgRecommendationsPerUser = logs.length > 0 
  ? logs.reduce((sum, log) => sum + log.shownPostIds.length, 0) / logs.length 
  : 0
```

---

### 13. **Precision Distribution**

**Định nghĩa**: Phân bố users theo mức độ precision.

**Phân loại**:
- **Zero (0%)**: Users không có hits
- **Low (0-10%)**: Users có ít hits
- **Medium (10-30%)**: Users có precision trung bình
- **High (>30%)**: Users có precision cao

**Ý nghĩa**: 
- Giúp hiểu phân bố chất lượng recommendations
- Nếu nhiều users ở mức Zero → có vấn đề với cold-start hoặc model

**Trong code** (dòng 310-315):
```typescript
const precisionDistribution = {
  zero: metrics.precisionAtK.filter(p => p === 0).length,
  low: metrics.precisionAtK.filter(p => p > 0 && p < 0.1).length,
  medium: metrics.precisionAtK.filter(p => p >= 0.1 && p < 0.3).length,
  high: metrics.precisionAtK.filter(p => p >= 0.3).length,
}
```

---

### 14. **Ground Truth Size Distribution**

**Định nghĩa**: Phân bố users theo số lượng items trong ground truth.

**Phân loại**:
- **Small (1-2 items)**: Users có ít interactions trong test set
- **Medium (3-5 items)**: Users có số interactions trung bình
- **Large (>5 items)**: Users có nhiều interactions

**Ý nghĩa**: 
- Giúp hiểu đặc điểm của test set
- Users với GT size nhỏ → khó đạt recall cao

**Trong code** (dòng 326-340):
```typescript
const usersByGTSize = {
  small: 0,   // 1-2 items
  medium: 0,  // 3-5 items
  large: 0,   // >5 items
}
```

---

## 🔍 **DEBUG METRICS**

### 15. **Zero Precision Users**

**Định nghĩa**: Sample users có Precision@K = 0 (không có hits).

**Thông tin lưu**:
- `userId`: ID của user
- `predictions`: Top 10 recommendations
- `truth`: Top 10 items trong ground truth
- `overlap`: Số items trùng (luôn = 0)

**Ý nghĩa**: 
- Giúp debug tại sao một số users không có hits
- Có thể do:
  - Cold-start (user mới, ít interactions)
  - Model không match với preferences
  - Ground truth không đầy đủ

**Trong code** (dòng 189, 204-212, 348-358):
```typescript
const zeroPrecisionUsers: Array<{ userId: string; predictions: string[]; truth: string[]; overlap: number }> = []

if (overlap === 0 && zeroPrecisionUsers.length < 5) {
  zeroPrecisionUsers.push({
    userId,
    predictions: predictions.slice(0, 10),
    truth: Array.from(truth).slice(0, 10),
    overlap: 0,
  })
}
```

---

## 📝 **TÓM TẮT CÁC METRICS**

| Metric | Phạm vi | Ý nghĩa | Mục tiêu |
|--------|---------|---------|----------|
| **Precision@K** | 0-1 | Độ chính xác | > 0.3 |
| **Recall@K** | 0-1 | Độ bao phủ relevant items | > 0.4 |
| **MAP@K** | 0-1 | Trung bình precision + ranking | > 0.3 |
| **NDCG@K** | 0-1 | Chất lượng ranking | > 0.4 |
| **Coverage** | 0-100% | % items được recommend | > 50% |
| **Catalog Coverage** | 0-100% | % catalog được recommend | > 20% |
| **Category Diversity** | 0-1 | Độ đa dạng categories | > 0.5 |
| **Author Diversity** | 0-1 | Độ đa dạng authors | > 0.5 |
| **Users With Hits** | 0-100% | % users có hits | > 70% |

---

## 💡 **CÁCH ĐỌC KẾT QUẢ**

### Kết quả tốt:
- ✅ Precision@K > 0.3
- ✅ Recall@K > 0.4
- ✅ MAP@K > 0.3
- ✅ NDCG@K > 0.4
- ✅ Users With Hits > 70%
- ✅ Diversity > 0.5

### Kết quả cần cải thiện:
- ⚠️ Precision@K < 0.2 → Cải thiện scoring, tăng candidate pool quality
- ⚠️ Recall@K < 0.3 → Tăng candidate pool size, cải thiện diversity
- ⚠️ Users With Hits < 50% → Xử lý cold-start, cải thiện fallback strategy
- ⚠️ Diversity < 0.3 → Tăng diversity filter, giảm bias về popular items

---

## 🔗 **THAM KHẢO**

- **Precision & Recall**: https://en.wikipedia.org/wiki/Precision_and_recall
- **MAP**: https://en.wikipedia.org/wiki/Evaluation_measures_(information_retrieval)#Mean_average_precision
- **NDCG**: https://en.wikipedia.org/wiki/Discounted_cumulative_gain
- **Coverage & Diversity**: Ricci et al., "Recommender Systems Handbook" (2015)

## 1. Accuracy Metrics (Top-K = 20)

| Feed | Users | Precision@20 | Recall@20 | MAP@20 | NDCG@20 |
|----|------:|-------------:|----------:|-------:|--------:|
| CBF | 1994 | **2.17%** | **3.51%** | **1.19%** | **3.79%** |
| CF | 826 | 0.92% | 1.22% | 0.40% | 1.50% |
| Hybrid | 2000 | 1.69% | 2.67% | 0.84% | 2.83% |

---

## 2. Coverage & Diversity Metrics

| Feed | GT Coverage | Catalog Coverage | Category Diversity | Overall Diversity |
|----|------------:|-----------------:|-------------------:|------------------:|
| CBF | **67.11%** | **72.72%** | 5.29% | 52.64% |
| CF | 56.14% | 59.93% | 34.64% | 67.08% |
| Hybrid | 53.46% | 57.97% | **35.26%** | **67.63%** |


