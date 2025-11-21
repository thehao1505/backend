export const estimateDwellTimeThreshold = (text: string, image: string[], readingSpeedWpm: number) => {
  if (!text && text.trim().length === 0 && image.length === 0) return 0

  const words = text.trim().split(/\s+/)
  const wordCount = words.filter(word => word.length > 0).length

  return (wordCount * 1000) / (readingSpeedWpm / 60) + image.length * 1500
}

export class VectorUtil {
  // Tính độ dài vector (Magnitude)
  static magnitude(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  }

  // Chuẩn hóa vector về độ dài 1 (L2 Normalization)
  static normalize(vector: number[]): number[] {
    const mag = this.magnitude(vector)
    if (mag === 0) return vector // Tránh chia cho 0
    return vector.map(val => val / mag)
  }

  // Cộng 2 vector: v1 + (v2 * weight)
  static weightedAdd(v1: number[], v2: number[], weight: number): number[] {
    return v1.map((val, i) => val + v2[i] * weight)
  }
}
