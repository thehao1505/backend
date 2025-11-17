export const estimateDwellTimeThreshold = (text: string, image: string[], readingSpeedWpm: number) => {
  if (!text && text.trim().length === 0 && image.length === 0) return 0

  const words = text.trim().split(/\s+/)
  const wordCount = words.filter(word => word.length > 0).length

  return (wordCount * 1000) / (readingSpeedWpm / 60) + image.length * 1500
}
