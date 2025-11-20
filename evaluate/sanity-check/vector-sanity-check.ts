// =========================================================================
// FILE: vector-sanity-check.ts
// MÔ TẢ: Script kiểm tra tính hợp lý của vector Post Embedding và Logic cập nhật User Persona.
// Mục đích: Xác nhận tính đúng đắn của logic tính toán trước khi tích hợp vào Qdrant.
// =========================================================================

// --- 1. HẰNG SỐ VÀ KHAI BÁO TỪ CÁC SERVICE ---

// Mô phỏng INTERACTION_WEIGHTS từ embedding.processor.ts
const INTERACTION_WEIGHTS: { [key: string]: number } = {
  LIKE: 0.15,
  SHARE: 0.35,
  UNLIKE: -0.15,
  POST_CLICK: 0.25,
  DEFAULT: 0.1,
}

type Vector = number[]
const VECTOR_DIMENSION = 5 // Dùng 5D cho mục đích demo

// --- 2. CÁC HÀM TIỆN ÍCH CỐT LÕI ---

/**
 * Tính toán Độ Tương Đồng Cosine (Cosine Similarity) giữa hai vector.
 * Đây là metric quan trọng nhất của hệ thống vì Qdrant dùng 'Cosine' distance.
 */
function calculateCosineSimilarity(vec1: Vector, vec2: Vector): number {
  if (vec1.length === 0 || vec2.length === 0) return 0

  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0)
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0))
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0))

  if (magnitude1 === 0 || magnitude2 === 0) return 0

  return dotProduct / (magnitude1 * magnitude2)
}

/**
 * Hàm mô phỏng calculateNewUserVector từ embedding.processor.ts
 * Kiểm tra logic dịch chuyển vector persona.
 */
function calculateNewUserVector(oldVector: Vector | null, newSignalVector: Vector, newSignalWeight: number): Vector {
  // Xử lý trường hợp người dùng mới (cold-start)
  if (!oldVector || oldVector.every(val => val === 0)) return newSignalVector

  if (oldVector.length !== newSignalVector.length) {
    throw new Error('Vector size does not match!')
  }

  if (newSignalWeight < 0) {
    // Logic cho tương tác tiêu cực (Ví dụ: UNLIKE)
    const weight = Math.abs(newSignalWeight)
    return oldVector.map((oldVal, i) => oldVal - (newSignalVector[i] - oldVal) * weight)
  }

  // Logic cho tương tác tích cực (Ví dụ: LIKE, SHARE)
  const oldVectorWeight = 1.0 - newSignalWeight
  return oldVector.map((oldVal, i) => oldVal * oldVectorWeight + newSignalVector[i] * newSignalWeight)
}

// --- 3. DỮ LIỆU GIẢ ĐỊNH (MOCK DATA) ---

// Vector 5D giả định để test semantic similarity
const postVectorNature1: Vector = [0.9, 0.8, 0.1, 0.1, 0.2] // Bài đăng A: Phong cảnh
const postVectorNature2: Vector = [0.8, 0.9, 0.0, 0.2, 0.1] // Bài đăng B: Động vật (Rất liên quan)
const postVectorTech1: Vector = [0.0, 0.1, 0.9, 0.8, 0.7] // Bài đăng C: Công nghệ (Không liên quan)

// Vector người dùng giả định để test persona shift
const userVectorOld: Vector = [0.5, 0.5, 0.0, 0.0, 0.0] // User ban đầu thiên về Thiên nhiên

// --- 4. CÁC HÀM KIỂM TRA ---

/**
 * Kiểm tra tính hợp lý của vector bài đăng (semantic similarity).
 */
function runPostEmbeddingSanityCheck(): boolean {
  console.log('==================================================')
  console.log('--- 1. Kiểm tra Chất lượng Vector Bài đăng (Post Embedding) ---')
  console.log(`Kiểm tra liệu Gemini Embeddings có đặt các khái niệm liên quan gần nhau không. (Kích thước: ${VECTOR_DIMENSION}D)`)
  console.log('==================================================')

  const simRelated = calculateCosineSimilarity(postVectorNature1, postVectorNature2)
  const simUnrelated = calculateCosineSimilarity(postVectorNature1, postVectorTech1)

  console.log(`Độ Tương đồng (Cặp liên quan - Phong cảnh vs Động vật): ${simRelated.toFixed(4)}`)
  console.log(`Độ Tương đồng (Cặp không liên quan - Phong cảnh vs Công nghệ): ${simUnrelated.toFixed(4)}`)

  const passed = simRelated > simUnrelated
  console.log(`\nKiểm tra Post Embedding: ${passed ? 'PASSED' : 'FAILED'} (Sim Liên quan > Sim Không liên quan)`)
  return passed
}

/**
 * Kiểm tra tính hợp lý của logic cập nhật vector người dùng (dịch chuyển persona).
 */
function runUserVectorUpdateSanityCheck(): boolean {
  console.log('\n==================================================')
  console.log('--- 2. Kiểm tra Logic Cập nhật Vector Người dùng (Persona Shift) ---')
  console.log('Kiểm tra liệu vector có dịch chuyển đúng theo trọng số tương tác không.')
  console.log('==================================================')

  // Lấy độ tương đồng ban đầu (User thiên nhiên vs Post Công nghệ)
  const initialSimilarity = calculateCosineSimilarity(userVectorOld, postVectorTech1)
  console.log(`Độ Tương đồng ban đầu (User vs Post Công nghệ): ${initialSimilarity.toFixed(4)}`)

  // --- Kịch bản A: Tương tác Tích cực (SHARE) ---
  const weightShare = INTERACTION_WEIGHTS['SHARE'] // W=0.35
  const userVectorAfterShare = calculateNewUserVector(userVectorOld, postVectorTech1, weightShare)
  const simAfterShare = calculateCosineSimilarity(userVectorAfterShare, postVectorTech1)
  console.log(`\n-> Sau SHARE (W=${weightShare}): Độ tương đồng mới là ${simAfterShare.toFixed(4)}`)
  const positiveShiftCheck = simAfterShare > initialSimilarity
  console.log(`Kết quả Dịch chuyển Tích cực: ${positiveShiftCheck ? 'PASSED' : 'FAILED'} (Phải tăng)`)

  // --- Kịch bản B: Tương tác Tiêu cực (UNLIKE) ---
  const weightUnlike = INTERACTION_WEIGHTS['UNLIKE'] // W=-0.15
  // Dùng lại vector cũ userVectorOld để mô phỏng trạng thái ban đầu
  const userVectorAfterUnlike = calculateNewUserVector(userVectorOld, postVectorTech1, weightUnlike)
  const simAfterUnlike = calculateCosineSimilarity(userVectorAfterUnlike, postVectorTech1)
  console.log(`\n-> Sau UNLIKE (W=${weightUnlike}): Độ tương đồng mới là ${simAfterUnlike.toFixed(4)}`)
  const negativeShiftCheck = simAfterUnlike < initialSimilarity
  console.log(`Kết quả Dịch chuyển Tiêu cực: ${negativeShiftCheck ? 'PASSED' : 'FAILED'} (Phải giảm)`)

  return positiveShiftCheck && negativeShiftCheck
}

// --- 5. HÀM CHÍNH ---
function main() {
  console.log('--- BẮT ĐẦU KIỂM TRA TÍNH HỢP LÝ CỦA HỆ THỐNG VECTOR ---')
  const postCheckPassed = runPostEmbeddingSanityCheck()
  const userCheckPassed = runUserVectorUpdateSanityCheck()

  console.log('\n==============================================')
  console.log('             ĐÁNH GIÁ TỔNG THỂ')
  console.log('==============================================')
  console.log(`1. Kiểm tra Post Embedding Logic: ${postCheckPassed ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`2. Kiểm tra Logic Cập nhật User Vector: ${userCheckPassed ? '✅ PASSED' : '❌ FAILED'}`)
  console.log('==============================================')
}

main()
