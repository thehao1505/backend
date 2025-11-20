# Offline Evaluation

## 1. Method

### 1. Precision@K

- Precision@K trong K items đầu tiên, có bao nhiêu items đúng
- Precision@K = (# relevant items in top-K) / K

- Ví dụ: Giả sử k = 10, trong đó chỉ có 3 item đúng với ground-truth -> Precision@10: 0.3
- Không quan tâm hệ thống bỏ sót bao nhiêu item, chỉ quan tâm trong top K có bao nhiêu đúng

### 2. Recall@K

- Recall@K trong tất cả các item đúng, bạn tìm được bao nhiêu trong top K
- Recall@K= (# relevant items in top-K)/(# total relevant items)

- Ví dụ: Giả sử k = 10, user có 20 bài viết liên quan trong ground-truth. Hệ thống gợi ý top 10, trong đó có 3 bài đúng -> Recall@K: 3/20 = 0.15
- Không quan tâm trong topK có bao nhiêu item sai, chỉ quan tâm hệ thốngtimf được bao nhiêu item đúng.

### 3. MAP (MEAN AVERAGE PRECISION)

- MAP là metric quan trọng nhất của hệ thống gợi ý/ranking.
- Nó đó chất lượng cả thứ tự trong danh sách.
- Map thì càng đưa item đúng lên cao -> điểm càng cao

- Formula: Giả sử 1 truy vấn có R item liên quan thực sự (ground-truth)
- Độ chính xác tại 1 điểm đó là: Precision@k = (#relevant-item-in-top-k)/k
- Average precision: AP = 1/R sum Precision@k

- Ví dụ: Ground-truth relevant = {A, B, C} {R=3}
- Model trả về ranking: [D, B, C, A, E, F]
- Rank 1: D → không relevant → bỏ qua.
- Rank 2: B → relevant → Precision@2 = 1/2 = 0.5
- Rank 3: C → relevant → Precision@3 = 2/3 ≈ 0.6666667
- Rank 4: A → relevant → Precision@4 = 3/4 = 0.75 AP = (0,5 + 0,67 + 0,75)/3 = 0,6389

## 2.
