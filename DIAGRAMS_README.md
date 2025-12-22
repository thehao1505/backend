# Hướng Dẫn Sử Dụng PlantUML Diagrams

File này chứa các sơ đồ PlantUML minh họa quy trình và công thức của CBF và CF algorithms.

## Các Sơ Đồ Có Sẵn

### 1. `CBF_Process_Flow` - Quy Trình CBF
- Mô tả đầy đủ flow của Content-Based Filtering
- Từ thu thập signals đến kết quả cuối cùng
- Bao gồm xử lý cold start

### 2. `CBF_Scoring_Formula` - Công Thức Tính Điểm CBF
- Chi tiết từng thành phần của Multi-Signal Scoring
- Weights và bonuses
- Visual hóa cách tính Final Score

### 3. `CF_Process_Flow` - Quy Trình CF
- Flow của Collaborative Filtering
- 4 bước chính: Interactions → Similar Users → Candidates → Scoring

### 4. `CF_Weighted_Jaccard_Example` - Ví Dụ Tính Similarity
- Ví dụ cụ thể tính Weighted Jaccard Similarity
- Step-by-step calculation
- Minh họa giữa 2 users

### 5. `CF_Scoring_Formula` - Công Thức Tính Điểm CF
- Chi tiết Multi-Signal Scoring của CF
- 6 thành phần chính với weights

### 6. `CBF_vs_CF_Comparison` - So Sánh CBF và CF
- Comparison table
- Hybrid approach
- Điểm mạnh/yếu của từng phương pháp

### 7. `Interaction_Weights` - Trọng Số Tương Tác
- Interaction weights (Reply, Share, Like, Click, View)
- Recency weights theo thời gian
- Công thức tính final weight

### 8. `Dual_Vector_Strategy` - Chiến Lược Dual Vector
- Long-term vs Short-term vectors
- Dynamic combination weights
- Cách tính similarity

## Cách Xem Sơ Đồ

### Option 1: Online Viewer (Khuyến nghị)
1. Truy cập: http://www.plantuml.com/plantuml/uml/
2. Copy code của một diagram (từ `@startuml` đến `@enduml`)
3. Paste vào editor
4. Xem kết quả

### Option 2: VS Code Extension
1. Cài đặt extension "PlantUML" trong VS Code
2. Mở file `.puml`
3. Nhấn `Alt+D` (Windows/Linux) hoặc `Option+D` (Mac) để preview
4. Hoặc click vào preview icon

### Option 3: Local PlantUML
1. Cài đặt Java: https://www.java.com/
2. Download PlantUML JAR: http://plantuml.com/download
3. Chạy lệnh:
   ```bash
   java -jar plantuml.jar CBF_CF_DIAGRAMS.puml
   ```
4. Kết quả: PNG files trong cùng thư mục

### Option 4: Convert sang PNG/PDF
Sử dụng online tool:
- http://www.plantuml.com/plantuml/png/
- Hoặc http://www.plantuml.com/plantuml/svg/

## Cách Sử Dụng trong Slide

### Method 1: Export PNG và Insert
1. Export diagram thành PNG
2. Insert vào PowerPoint/Keynote
3. Có thể chỉnh sửa text/colors nếu cần

### Method 2: Sử dụng Online Viewer
1. Upload file lên GitHub/Google Drive
2. Sử dụng raw URL trong PlantUML online viewer
3. Embed vào slide nếu hỗ trợ iframe

### Method 3: Convert sang Vector Format
1. Export thành SVG (scalable, tốt cho in ấn)
2. Import vào slide
3. Có thể chỉnh sửa trong Illustrator/Inkscape

## Tips

1. **Màu sắc**: Đã được thiết kế với màu sắc phân biệt rõ ràng
   - CBF: Blue tones (#E3F2FD, #1976D2)
   - CF: Green tones (#F1F8E9, #558B2F)
   - Hybrid/Comparison: Purple tones (#F3E5F5, #7B1FA2)

2. **Kích thước**: 
   - Có thể adjust trong code bằng `scale` directive
   - Thêm vào đầu diagram: `scale 1.5` (tăng 50%)

3. **Customization**:
   - Có thể thay đổi màu sắc trong `skinparam`
   - Thêm/bớt notes tùy nhu cầu
   - Điều chỉnh layout nếu cần

4. **Animation trong Slide**:
   - Export từng phần thành các PNG riêng
   - Tạo animation trong PowerPoint bằng "Appear" effect
   - Hoặc dùng slide transitions

## Ví Dụ Sử Dụng trong Presentation

### Slide 9: CBF Process
- Sử dụng: `CBF_Process_Flow`
- Có thể tách thành 2 slides nếu cần:
  - Slide 9a: Thu thập Signals
  - Slide 9b: Scoring và Results

### Slide 10: CBF Scoring
- Sử dụng: `CBF_Scoring_Formula`
- Có thể kết hợp với `Dual_Vector_Strategy` nếu muốn giải thích chi tiết hơn

### Slide 11: CF Process
- Sử dụng: `CF_Process_Flow`
- Có thể thêm `CF_Weighted_Jaccard_Example` ở slide phụ

### Slide 12: CF Scoring & Similarity
- Sử dụng: `CF_Weighted_Jaccard_Example` (ví dụ)
- Và `CF_Scoring_Formula` (công thức)

### Slide 13: Comparison
- Sử dụng: `CBF_vs_CF_Comparison`
- Có thể thêm `Interaction_Weights` nếu muốn giải thích chi tiết weights

## Troubleshooting

**Vấn đề**: Diagram quá lớn, không vừa slide
- **Giải pháp**: Thêm `scale 0.8` hoặc `scale 0.7` vào đầu diagram

**Vấn đề**: Màu sắc không hiển thị đúng
- **Giải pháp**: Đảm bảo sử dụng theme `plain` hoặc check color codes

**Vấn đề**: Text bị cắt
- **Giải pháp**: Sử dụng `\n` để xuống dòng, hoặc giảm font size

**Vấn đề**: Export quality thấp
- **Giải pháp**: Export SVG thay vì PNG, hoặc tăng DPI khi export PNG

