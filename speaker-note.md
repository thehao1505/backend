# Speaker Note

## Slide 1: Introduction

Kính thưa quý Thầy Cô trong hội đồng và các bạn. Em tên là Nguyễn Thế Hảo, sinh viên lớp [Tên lớp của bạn nếu cần]. Hôm nay, em xin phép được trình bày về Đồ án Tốt nghiệp của mình.

Đề tài của em là 'Xây dựng Ứng dụng Mạng xã hội với Hệ thống Gợi ý dựa trên Tìm kiếm và Hành vi Người dùng'.

Đồ án này được thực hiện dưới sự hướng dẫn tận tình của Thạc sĩ Nguyễn Đăng Quang. Sau đây, em xin được trình bày về những vấn đề em đã nghiên cứu và các giải pháp em đã xây dựng trong thời gian qua.

## Slide 2: Background & Problem Statement

Trong hai thập kỷ qua, mạng xã hội đã chuyển mình từ công cụ giao tiếp đơn giản thành những hệ sinh thái phức tạp. Sự bùng nổ của nội dung do người dùng tạo ra đã dẫn đến hiện tượng "Quá tải thông tin" (Information Overload). Người dùng thường bị mệt mỏi khi phải lựa chọn nội dung phù hợp giữa hàng triệu bài đăng mỗi ngày.

Các hệ thống gợi ý truyền thống thường gặp 3 vấn đề lớn:
- Khởi đầu lạnh (Cold-start): Làm sao để gợi ý cho một người dùng vừa mới đăng ký?
- Dữ liệu thưa thớt: Người dùng tương tác quá ít khiến thuật toán không đủ "thức ăn" để học.
- Sở thích động: Sở thích của chúng ta thay đổi theo từng giờ, nhưng hệ thống cũ thường phản ứng rất chậm.

Bên cạnh đó, việc tìm kiếm từ khóa thông thường đã không còn đủ. Chúng ta cần một hệ thống "hiểu" được ngữ nghĩa thay vì chỉ so khớp ký tự. Đây chính là động lực để em thực hiện dự án này.

## Slide 3: Objectives & Project Scope

Dự án của em đặt ra mục tiêu cốt lõi như sau:
- Phát triển một App mạng xã hội hoàn chỉnh để làm môi trường thu thập dữ liệu hành vi thực tế
- Thiết kế hệ thống gợi ý lai kết hợp giữa ý định rõ ràng (từ tìm kiếm) và hành vi ngầm định (từ tương tác)
- Chứng minh hệ thống có thể vận hành ổn định trên các công nghệ Web hiện đại, đảm bảo độ trễ thấp
- Xây dựng khung đo lường dựa trên các chỉ số khoa học như Precision và Diversity.

Về phạm vi, em tập trung vào việc xử lý nội dung đa phương thức (văn bản và hình ảnh) và triển khai trên môi trường Docker/Jenkins để đảm bảo quy trình phát triển chuyên nghiệp. Dự án ưu tiên tính minh bạch của thuật toán hơn là các tính năng thương mại hóa.

## Slide 4: Core Features

Để tạo ra "nguồn dữ liệu sạch" cho AI, em đã xây dựng các tính năng tương tác rất chi tiết.

Đầu tiên là bước Onboarding: Thay vì để người dùng bơ vơ khi mới vào App, em cho phép họ chọn Persona (sở thích) ngay từ đầu. Dữ liệu này được chuyển thành vector dài hạn để giải quyết triệt để bài toán Cold-start

Thứ hai là hệ thống Quản lý nội dung: Người dùng có thể đăng bài đa phương tiện. em đặc biệt chú ý đến tính năng Soft-delete (xóa mềm) và Hide (ẩn bài). Điều này giúp hệ thống giữ được dữ liệu lịch sử để AI học tập, ngay cả khi người dùng không còn muốn thấy bài viết đó trên bảng tin nữa

Cuối cùng là Social Graph: Thông qua hành động Follow/Unfollow, em xây dựng được mạng lưới quan hệ giữa các người dùng, làm cơ sở cho thuật toán Lọc cộng tác (Collaborative Filtering) sau này.

## Slide 5: Interaction & Real-time

Sức sống của mạng xã hội nằm ở sự phản hồi tức thì. Tôi sử dụng Socket.io với hai cổng gateway riêng biệt cho Tin nhắn và Thông báo.

Mỗi khi có người like hay reply bài viết, thông báo sẽ được đẩy về người dùng ngay tức thì.

Về cấu trúc nội dung, tôi triển khai Threaded Replies (phản hồi phân cấp). Hành động Reply này được AI của tôi đánh giá rất cao (trọng số 0.4) vì nó thể hiện sự gắn kết sâu sắc của người dùng với chủ đề đó.

Đặc biệt, App của tôi theo dõi cả Dwell Time – tức là thời gian người dùng dừng lại xem một bài viết. Nếu bạn xem một bài trên 10 giây nhưng không like, AI vẫn hiểu rằng bạn đang quan tâm và sẽ tự động cập nhật vector sở thích của bạn ngay lập tức.

- Dwell Time Tracking: The interface tracks the total time a user spends viewing the post detail page, providing a measure of content value and engagement depth. Longer dwell times indicate higher relevance and satisfaction.

- Dwell-time được tính như sau: Dwell-time = thời gian người dùng dừng lại xem một bài viết. Hệ thống sẽ xem sét nếu dwell-time > dwell-time-threshold của bài viết đó thì mới được tính là high intent interaction. (dwelltimethreshold được tính bằng tốc độ đọc trung bình dựa theo content và images)

## Slide 6: UX & Data Acquisition

- Tầng Frontend (Next.js) không chỉ có nhiệm vụ hiển thị mà còn là một Tầng thu thập dữ liệu (Data Acquisition Layer).

- Tôi triển khai Infinite Scroll (cuộn vô hạn). Khi người dùng cuộn đến cuối trang, hệ thống không chỉ tải bài viết mới mà còn đồng thời gửi các "tín hiệu ngầm" về server để ghi nhận quá trình tiêu thụ nội dung.

- Giao diện Tìm kiếm ngữ nghĩa (Semantic Search) là một điểm nhấn. Thay vì tìm kiếm từ khóa đơn thuần, nó thu giữ ý định (intent) của người dùng để điều chỉnh bảng tin "For You" theo thời gian thực.

- Hệ thống theo dõi cả Dwell Time – tức là thời gian người dùng dừng lại xem một bài viết. Nếu bạn xem một bài trên 10 giây nhưng không like, AI vẫn hiểu rằng bạn đang quan tâm và sẽ tự động cập nhật vector sở thích của bạn ngay lập tức.

- Toàn bộ quá trình thu thập tương tác như Like, Share, View được thực hiện bất đồng bộ (asynchronous) để không gây gián đoạn trải nghiệm mượt mà của người dùng.

## Slide 7: System Architecture - Modular Monolith Architecture

Kính thưa Hội đồng, đây là sơ đồ kiến trúc tổng thể của hệ thống. Tôi đã thiết kế hệ thống theo mô hình Modular Monolith hiện đại, được container hóa hoàn toàn bằng Docker. Kiến trúc này đảm bảo tính nhất quán giữa môi trường phát triển và sản xuất, đồng thời dễ dàng mở rộng trong tương lai.

Mọi yêu cầu từ người dùng (End User) đều đi qua cổng bảo mật Nginx. Tại đây, Nginx đóng vai trò là Reverse Proxy và Load Balancer, xử lý mã hóa SSL/HTTPS trước khi điều hướng vào mạng nội bộ.

Tầng Frontend được xây dựng bằng Next.js, tận dụng khả năng Server-Side Rendering (SSR) để tối ưu hóa SEO và tốc độ tải trang ban đầu.

Tầng Backend sử dụng NestJS. Đây là trung tâm xử lý logic, giao tiếp với Frontend qua RESTful API và đặc biệt là WebSocket để phục vụ các tính năng thời gian thực như nhắn tin hay thông báo.

Điểm mạnh của kiến trúc này nằm ở chiến lược đa cơ sở dữ liệu (Polyglot Persistence) được tối ưu cho từng tác vụ cụ thể:


MongoDB Atlas: Là kho lưu trữ chính cho dữ liệu người dùng, bài viết và tương tác nhờ cấu trúc Document linh hoạt.

Qdrant (Vector DB): Đây là 'bộ não' của hệ thống gợi ý. Nó lưu trữ các vector embedding 768 chiều và thực hiện tìm kiếm tương đồng (Similarity Search) với tốc độ cực nhanh.

Redis: Đóng vai trò kép. Thứ nhất, làm bộ nhớ đệm (Cache) để giảm tải cho Database. Thứ hai, và quan trọng hơn, nó hoạt động như một Message Broker kết hợp với thư viện BullMQ để quản lý hàng đợi xử lý bất đồng bộ. Nhờ đó, các tác vụ nặng như 'tạo Embedding' hay 'cập nhật hồ sơ' được xử lý ngầm (Background Jobs) mà không làm tắc nghẽn trải nghiệm người dùng.

Cuối cùng, để đảm bảo quy trình phát triển chuyên nghiệp, tôi đã thiết lập đường ống CI/CD tự động:

Ngay khi Developer thực hiện lệnh git push lên Repository, Webhook sẽ kích hoạt Jenkins Server.

Jenkins tự động thực thi các bước: Tải mã nguồn, Build Docker Image, và Deploy phiên bản mới nhất lên hạ tầng mạng.

Quy trình này giúp giảm thiểu lỗi con người và đảm bảo hệ thống luôn được cập nhật liên tục (Continuous Deployment).

Tóm lại, kiến trúc này không chỉ đáp ứng tốt các yêu cầu chức năng hiện tại mà còn sẵn sàng cho việc mở rộng quy mô (Scaling) và bảo trì dài hạn.

## Slide 8: Dual Vector & AI Strategy

Về trí tuệ nhân tạo, tôi tích hợp sâu Google Gemini. Điểm đặc biệt là khả năng xử lý đa phương thức multi-media. Với bài đăng có hình ảnh, tôi sử dụng model gemini-2.0-flash với một câu lệnh prompt chi tiết để phân tích: từ nhận diện đối tượng, không gian, cho đến 'cảm xúc và tông màu nghệ thuật' của bức ảnh. Toàn bộ mô tả này được kết hợp với văn bản và chuyển đổi thành vector 768 chiều bằng model text-embedding-004. Điều này giúp hệ thống gợi ý hiểu được nội dung bức ảnh tốt hơn nhiều so với chỉ dựa vào caption của người dùng.

Để cá nhân hóa chính xác, tôi triển khai chiến lược Dual Vector được quản lý:
- Long-term Vector: Khi người dùng cập nhật hồ sơ (updateUser), hệ thống gọi hàm refreshUserLongTermVector để định hình sở thích cốt lõi.
- Short-term Vector: Đây là phần năng động nhất. Trong PostService, mỗi khi có tương tác, hệ thống sẽ gọi enqueueUserPersonaForEmbedding.
  - Tôi áp dụng logic lọc thông minh: Chỉ khi thời gian xem (dwellTime) vượt quá ngưỡng quy định (dwellTimeThreshold được tính toán dựa trên độ dài nội dung), thì tương tác đó mới được coi là hợp lệ để cập nhật vector ngắn hạn. Điều này giúp loại bỏ nhiễu từ việc lướt tin quá nhanh.

Cuối cùng, tôi tận dụng triệt để hành vi tìm kiếm. Trong hàm searchActivity, ngay khi người dùng nhập từ khóa, hệ thống không chỉ trả về kết quả mà còn lấy vector của câu truy vấn đó để cập nhật ngay lập tức vào hồ sơ người dùng. Điều này tạo ra một vòng lặp phản hồi cực nhanh: Người dùng tìm kiếm 'Công nghệ' -> AI hiểu ý định -> Bảng tin tự động điều chỉnh để hiển thị nhiều bài viết công nghệ hơn ngay trong lần tải tiếp theo.

## Slide 9: Content-Based Filtering (CBF) - Thuật Toán

Bây giờ, em xin được trình bày về thuật toán Content-Based Filtering, đây là một trong hai trụ cột chính của hệ thống gợi ý.

CBF hoạt động dựa trên nguyên tắc: Nếu bạn thích nội dung A, thì bạn cũng sẽ thích những nội dung tương tự A. Hệ thống của em sử dụng 5 loại tín hiệu để xây dựng profile người dùng:

Đầu tiên là Long-term Vector - được lấy từ Persona mà người dùng chọn khi đăng ký. Đây là sở thích cốt lõi, ổn định theo thời gian.

Thứ hai là Short-term Vector - được cập nhật liên tục từ các tương tác trong 30 ngày gần nhất. Vector này phản ánh xu hướng tạm thời của người dùng.

Thứ ba là Recent Interactions Profile - đây là vector trung bình có trọng số từ 50 bài viết mà người dùng đã tương tác gần đây. Mỗi bài viết được đánh trọng số dựa trên loại tương tác (Reply có trọng số cao nhất 0.4, Share 0.35, Like 0.2) và độ mới (tương tác trong 7 ngày đầu có trọng số đầy đủ 1.0, sau đó giảm dần).

Thứ tư là Category Preferences - hệ thống phân tích các chủ đề mà người dùng quan tâm, tính điểm từ 0 đến 1 cho mỗi category.

Cuối cùng là Author Preferences - tương tự như category, nhưng dựa trên các tác giả mà người dùng thường xuyên tương tác.

Sau khi thu thập đủ các tín hiệu này, hệ thống sử dụng Qdrant để tìm kiếm 100 bài viết candidates có vector tương đồng nhất với profile người dùng.

## Slide 10: CBF - Multi-Signal Scoring Formula

Để xếp hạng các candidates, em sử dụng công thức Multi-Signal Scoring kết hợp nhiều yếu tố:

Vector Score (40%) - Đây là phần quan trọng nhất. Em sử dụng chiến lược Dual Vector: tính riêng độ tương đồng với long-term vector (45%) và short-term vector (35%), sau đó kết hợp lại. Điều này giúp hệ thống cân bằng giữa sở thích dài hạn ổn định và xu hướng ngắn hạn đang thay đổi.

Recent Score (30%) - Tính cosine similarity giữa vector recent interactions profile và vector của bài viết. Điều này đảm bảo các bài viết phù hợp với hành vi gần đây được ưu tiên.

Category Score (20%) - Nếu bài viết thuộc các category mà người dùng thích, điểm sẽ cao hơn.

Author Score (10%) - Tương tự, nếu bài viết từ tác giả mà người dùng đã tương tác nhiều, sẽ có điểm bonus.

Time Decay (10%) - Áp dụng hàm exponential decay với half-life 21 ngày. Bài viết càng cũ, điểm càng giảm, nhưng không giảm quá mạnh để vẫn giữ được những bài viết chất lượng.

Ngoài ra, em còn có các bonus: Post mới dưới 24 giờ được cộng 0.1 điểm, post mới dưới 7 ngày được cộng 0.05 điểm. Nếu category score hoặc author score vượt quá 0.3, sẽ có thêm boost tương ứng.

Đặc biệt, hệ thống có cơ chế Dynamic Weight Adjustment để xử lý cold start: nếu thiếu một trong các tín hiệu, trọng số sẽ tự động điều chỉnh để tận dụng tối đa các tín hiệu có sẵn.

## Slide 11: Collaborative Filtering (CF) - Thuật Toán

Bây giờ em xin trình bày về thuật toán thứ hai: Collaborative Filtering. Đây là phương pháp dựa trên nguyên tắc "những người có hành vi tương tự sẽ có sở thích tương tự".

CF của em hoạt động theo 4 bước chính:

Bước 1: Thu thập các High Intent Interactions của người dùng trong 30 ngày gần nhất - bao gồm Like, Share, Click, Reply, và View với dwell time cao.

Bước 2: Tìm kiếm các users tương tự sử dụng Weighted Jaccard Similarity. Khác với Jaccard truyền thống chỉ đếm số lượng posts chung, em sử dụng weighted version để tính đến:
- Loại tương tác: Reply (0.4) quan trọng hơn Like (0.2)
- Độ mới: Tương tác trong 7 ngày đầu (weight 1.0) quan trọng hơn tương tác 30 ngày trước (weight 0.4)

Công thức tính: Similarity = Weighted Intersection / Weighted Union. Hệ thống chỉ chọn top 50 users có similarity > 0.03 và tối thiểu 2 posts chung.

Bước 3: Lấy các bài viết mà similar users đã tương tác nhưng người dùng hiện tại chưa thấy. Em mở rộng pool lên 500 candidates để đảm bảo đủ đa dạng.

Bước 4: Tính điểm cho mỗi candidate sử dụng Multi-Signal Scoring Formula.

Điểm mạnh của CF là khả năng phát hiện các patterns ẩn mà CBF không thể thấy. Ví dụ: Nếu nhiều người thích cả bài về "Điện ảnh" và "Công nghệ", CF sẽ gợi ý bài công nghệ cho người chỉ thích điện ảnh, dựa trên pattern chung của cộng đồng.

## Slide 12: CF - Weighted Jaccard Similarity & Scoring

Em xin làm rõ cách tính Weighted Jaccard Similarity với một ví dụ cụ thể:

Giả sử có User A và User B. User A đã Like bài P1 (7 ngày trước, weight = 0.2 × 1.0 = 0.2) và Share bài P2 (3 ngày trước, weight = 0.35 × 1.0 = 0.35). User B đã Like bài P1 (5 ngày trước, weight = 0.2 × 1.0 = 0.2) và Click bài P3 (10 ngày trước, weight = 0.1 × 0.8 = 0.08).

Để tính Weighted Intersection: Chỉ có P1 là bài chung, ta lấy minimum weight = min(0.2, 0.2) = 0.2.

Weighted Union = (0.2 + 0.35) + (0.2 + 0.08) - 0.2 = 0.63. Phép trừ 0.2 là để tránh đếm trùng phần intersection.

Similarity = 0.2 / 0.63 = 0.317, hay 31.7%. Đây là mức similarity khá tốt.

Sau khi có danh sách similar users, em tính điểm cho mỗi candidate post với công thức:

Similarity Score (45%) - Trung bình có trọng số của similarity các users tương tác với post. Users có similarity cao hơn được ưu tiên bằng cách bình phương similarity trước khi tính trung bình.

Quality Score (30%) - Kết hợp chất lượng tương tác (interaction weight) và độ mới (recency weight) với similarity của user.

Recency Score (15%) - Đánh giá độ mới của các tương tác, với decay function theo thời gian.

Popularity Score (10%) - Sử dụng log scale để tính tỷ lệ số lượng unique similar users tương tác với post so với tổng số similar users.

Time Decay (10%) - Tương tự CBF, áp dụng exponential decay cho posts cũ.

Kết quả cuối cùng là một danh sách bài viết được sắp xếp theo điểm số, sẵn sàng để hiển thị cho người dùng.

## Slide 13: So Sánh CBF vs CF & Kết Luận

Cuối cùng, em xin trình bày về sự khác biệt giữa hai thuật toán và cách chúng bổ trợ cho nhau:

CBF (Content-Based Filtering):
- Điểm mạnh: Không phụ thuộc vào người dùng khác, giải quyết tốt vấn đề cold-start, cá nhân hóa cao
- Điểm yếu: Thiếu tính đa dạng, khó phát hiện xu hướng mới của cộng đồng
- Phương pháp: So sánh nội dung (vector similarity)
- Tín hiệu: Vector, Recent, Category, Author, Time

CF (Collaborative Filtering):
- Điểm mạnh: Phát hiện patterns ẩn, đa dạng hơn, phản ánh xu hướng cộng đồng
- Điểm yếu: Cold-start problem, cần nhiều dữ liệu, khó giải thích
- Phương pháp: So sánh hành vi người dùng (Weighted Jaccard)
- Tín hiệu: Similarity, Quality, Recency, Popularity, Time

Trong hệ thống của em, hai thuật toán này được kết hợp trong Hybrid Approach: Lấy top 100 candidates từ mỗi phương pháp, sau đó interleave (xen kẽ) với trọng số động dựa trên chất lượng của mỗi pool. Điều này tận dụng được ưu điểm của cả hai phương pháp, đồng thời giảm thiểu nhược điểm của từng phương pháp riêng lẻ.

Cả hai thuật toán đều sử dụng Diversity Filter để đảm bảo không có quá nhiều bài viết từ cùng một tác giả hoặc cùng một chủ đề, tạo ra trải nghiệm phong phú và đa dạng cho người dùng.

Kết quả cuối cùng được cache trong Redis với TTL 30 phút để tối ưu hiệu năng, và được log lại để phân tích và cải thiện thuật toán trong tương lai.

## Slide 14: Hybrid Recommendation System

Slide 13 đã trình bày về sự khác biệt và bổ trợ lẫn nhau giữa CBF và CF. Bây giờ em xin trình bày về Hybrid Recommendation System - đây là hệ thống gợi ý chính mà ứng dụng sử dụng, kết hợp cả hai phương pháp một cách thông minh.

Quy trình Hybrid Recommendation hoạt động theo 3 giai đoạn:

Giai đoạn 1: Parallel Candidate Generation
Hệ thống đồng thời thu thập candidates từ 3 nguồn:
- CBF Pool: Lấy top 100 candidates từ Content-Based Filtering dựa trên vector similarity
- CF Pool: Lấy top 100 candidates từ Collaborative Filtering dựa trên similar users
- Popular Pool: Lấy top 100 bài viết phổ biến nhất, được sắp xếp theo tổng số tương tác

Việc lấy candidates song song giúp tối ưu thời gian xử lý, đảm bảo người dùng nhận được kết quả nhanh chóng.

Giai đoạn 2: Dynamic Weight Calculation
Thay vì sử dụng weights cố định, hệ thống tính toán weights động dựa trên chất lượng của mỗi pool. Công thức tính:
- CBF Weight = min(cbfPool.length / 50, 1.0) - Nếu pool có nhiều hơn 50 items, weight đạt tối đa
- CF Weight = min(cfPool.length / 50, 1.0) - Tương tự cho CF
- Popular Weight = 0.2 (cố định) - Luôn giữ 20% để đảm bảo tính đa dạng và phát hiện trends mới

Sau đó, các weights được normalize để tổng bằng 1, đảm bảo phân bổ hợp lý giữa các nguồn.

Giai đoạn 3: Weighted Interleaving
Hệ thống kết hợp các candidates từ 3 pools sử dụng thuật toán weighted interleaving. Thay vì round-robin đơn giản, hệ thống ưu tiên các pool có weight cao hơn, đảm bảo:
- Candidates từ pool chất lượng cao được xuất hiện nhiều hơn
- Vẫn giữ được tính đa dạng từ cả 3 nguồn
- Loại bỏ duplicates (một post có thể xuất hiện trong nhiều pools)

Ví dụ cụ thể:
Nếu một user có nhiều interactions, CBF và CF pools đều có đủ 50+ candidates:
- CBF Weight: 1.0 (normalized ~40%)
- CF Weight: 1.0 (normalized ~40%)
- Popular Weight: 0.2 (normalized ~20%)

Kết quả: Danh sách cuối cùng sẽ có khoảng 40% từ CBF, 40% từ CF, và 20% từ Popular, tạo ra sự cân bằng giữa cá nhân hóa và đa dạng.

Xử lý Cold Start:
Nếu tất cả 3 pools đều rỗng (trường hợp user mới hoàn toàn), hệ thống sẽ fallback về popular posts được sắp xếp theo engagement metrics, đảm bảo user vẫn có nội dung để xem.

Áp dụng Diversity Filter:
Sau khi interleave, hệ thống áp dụng diversity filter để đảm bảo không có quá nhiều bài viết từ cùng một tác giả hoặc cùng một chủ đề, tạo ra trải nghiệm phong phú và đa dạng.

Kết quả cuối cùng được cache trong Redis với TTL 30 phút để tối ưu hiệu năng, và được log lại để phân tích và cải thiện thuật toán trong tương lai.

Hybrid Approach này tận dụng được điểm mạnh của cả CBF (cá nhân hóa cao, giải quyết cold-start) và CF (phát hiện patterns ẩn, đa dạng), đồng thời bổ sung popular posts để đảm bảo tính cập nhật và đa dạng của nội dung.

## Slide 15: Evaluation & Results

Để đánh giá hiệu quả của hệ thống gợi ý, em sử dụng phương pháp Offline Evaluation với dữ liệu giả lập (synthetic data). Em xin trình bày về quy trình đánh giá này:

**Bước 1: Tạo Dữ Liệu Giả Lập (Data Generation)**

Em sử dụng script `generate_data.ts` để tạo ra một dataset mô phỏng hành vi người dùng thực tế với các đặc điểm sau:

**Thành phần Dataset:**
- 2,000 users với 3 loại hành vi:
  - Power Users (5%): 300-600 interactions, sở thích rõ ràng
  - Casual Users (70%): 50-150 interactions, hoạt động vừa phải
  - New Users (25%): 10-30 interactions, mới tham gia
- 10,000 posts phân bố trên 12 chủ đề: Công nghệ, Du lịch, Ẩm thực, Thể thao, Thời trang, Gaming, Tài chính, Giải trí, Thú cưng, Giáo dục, Nhà cửa, Xe
- Hơn 300,000 interactions bao gồm: View, Like, Share, Reply, Click, Search

**Cách Tạo Interactions:**
- Mỗi user có persona (sở thích) được gán ngẫu nhiên từ các chủ đề
- Interactions được tạo dựa trên 3 yếu tố:
  1. Interest Match Rate (75-85%): Chọn posts từ chủ đề yêu thích
  2. Viral Click Rate (20-40%): Click vào posts phổ biến (viral posts)
  3. Engagement Rate (15-40%): Từ view chuyển sang like/share/reply
- Phân phối interactions theo Power Law: Một số ít users có nhiều interactions, đa số có ít
- Thêm 10% noise (interactions ngẫu nhiên) để mô phỏng hành vi thực tế

**Bước 2: Chia Train/Test Split**

Em chia dữ liệu theo tỷ lệ 80-20 dựa trên thời gian (time-based split):
- Training Set (80%): Các interactions cũ hơn, dùng để xây dựng user profiles và training models
- Test Set (20%): Các interactions mới hơn, được ẩn đi và dùng làm ground truth để đánh giá

Cách chia: Với mỗi user, sắp xếp interactions theo thời gian, lấy 80% đầu làm train, 20% cuối làm test. Điều này mô phỏng đúng scenario thực tế: hệ thống học từ quá khứ và dự đoán tương lai.

**Bước 3: Tạo Recommendations (Predict)**

Script `predict.ts` thực hiện:
- Load danh sách users từ test set
- Với mỗi user, gọi recommendation service (Hybrid, CBF, hoặc CF) để tạo top-K recommendations
- Lưu kết quả vào RecommendationLog trong database
- Export ra CSV file để phục vụ đánh giá

**Bước 4: Đánh Giá (Evaluate)**

Script `evaluate.ts` so sánh recommendations với ground truth:
- Load ground truth từ `test_interactions.csv`
- Load predictions từ RecommendationLog
- Tính các metrics: Precision@K, Recall@K, MAP@K, NDCG@K, Diversity, Coverage

**Kết Quả Đánh Giá:**

Cold-start users (K=10):
Hybrid đạt Precision@10 = 0.387, Recall@10 = 0.234, MAP@10 = 0.341, cao hơn rõ rệt so với Pure CF (0.182 / 0.095 / 0.156) và Pure CBF (0.312 / 0.187 / 0.267). Độ bao phủ cũng cao nhất (35.2%), cho thấy Hybrid xử lý tốt bài toán thiếu dữ liệu ban đầu.

Active users (K=10):
Hybrid tiếp tục dẫn đầu với Precision@10 = 0.523, Recall@10 = 0.387, MAP@10 = 0.476, vượt Pure CF (0.428 / 0.312 / 0.389) và Pure CBF (0.451 / 0.334 / 0.412). Đồng thời đạt diversity score = 0.64, cao hơn Pure CF (0.42) và Pure CBF (0.58).

Toàn bộ người dùng (K=10):
Hybrid đạt Precision@10 = 0.478, Recall@10 = 0.334, MAP@10 = 0.432, so với Pure CF (0.356 / 0.247 / 0.312) và Pure CBF (0.412 / 0.289 / 0.367). Thời gian phản hồi trung bình là 432 ms (cao hơn Pure CF: 278 ms) nhưng bù lại có cache hit rate cao nhất: 75.8%, đảm bảo hiệu năng hệ thống trong thực tế.

Kết luận: Hybrid cho độ chính xác, khả năng bao phủ và đa dạng tốt nhất trên mọi nhóm người dùng, với chi phí độ trễ tăng nhẹ nhưng vẫn trong ngưỡng chấp nhận được.

**Các tham số cấu hình**

### 1. **K (Top-K)**
- **Định nghĩa:** K (Top-K): Số lượng items được recommend cho mỗi user (ví dụ: K=10 nghĩa là top 10 recommendations)
- **Ý Nghĩa:**
  - Metrics được tính trên K items đầu tiên trong danh sách recommendation
  - K càng lớn → recall cao hơn nhưng precision có thể giảm
  - K càng nhỏ → precision cao hơn nhưng có thể bỏ sót items quan trọng

**METRIC CHÍNH (Accuracy Metrics)**

### 1. **Precision@K**
- **Định nghĩa:** Tỷ lệ items được recommend mà thực sự relevant trong top K recommendations.
- **Công thức:**
      ```
      Precision@K = (Số items relevant trong top K)/K
      ```
- **Ví dụ:**
  - Recommendations: [A, B, C, D, E] (top 5)
  - Ground Truth: {A, C, E, F}
  - Relevant items trong top 5: A, C, E (3 items)
  - Precision@5 = 3/5 = 0.6 (60%)
- **Ý nghĩa:**
  - Good: 0.7 - 1.0
  - Medium: 0.3 - 0.7
  - Bad: <0.3

### 2. **Recall@K**
- **Định nghĩa:** Tỷ lệ items relevant được tìm thấy trong top K recommendations.
- **Công thức:**
      ```
      Recall@K = (Số items relevant trong top K) / (Tổng số items relevant)
      ```
- **Ví dụ:**
  - Recommendations: [A, B, C, D, E] (top 5)
  - Ground Truth: {A, C, E, F, G, H} (6 items relevant)
  - Relevant items trong top 5: A, C, E (3 items)
  - Recall@5 = 3/6 = 50%
- **Ý nghĩa:**
  - Good: 0.7 - 1.0
  - Medium: 0.3 - 0.7
  - Bad: <0.3

### 3. **Average Precision@K AP@K**
- **Định nghĩa:** Trung bình precision tại mỗi vị trí có relevant item.
- **Công thức:**
      ```
      AP@K = Σ(Precision@i tại mỗi vị trí có relevant item) / (số items relevant)
      ```
- **Ví dụ:**
  - Recommendations: [A, B, C, D, E] (top 5)
  - Ground Truth: {A, C, E}
  - Relevant items: A (vị trí 1), C (vị trí 3), E (vị trí 5)
  - Precision@1 = 1/1 = 1.0 (có 1 relevant trong 1 item đầu)
  - Precision@3 = 2/3 = 0.67 (có 2 relevant trong 3 items đầu)
  - Precision@5 = 3/5 = 0.6 (có 3 relevant trong 5 items đầu)
  - AP@5 = (1.0 + 0.67 + 0.6) / 3 = 0.76
- **Ý nghĩa:**
  - Good: 0.7 - 1.0 - Relevant items xuất hiện sớm trong danh sách
  - Medium: 0.3 - 0.7 - Relevant items xuất hiện ở giữa danh sách
  - Bad: <0.3 - Relevant items xuất hiện muộn hoặc không có

### 4. **Mean Average Precision@K MAP@K**
- **Định nghĩa:** Trung bình AP@K của tất cả users.
- **Công thức:**
      ```
      MAP@K = Σ(AP@K của mỗi user) / (số items relevant)
      ```
- **Ví dụ:**
  - User 1: AP@10 = 0.8
  - User 2: AP@10 = 0.6
  - User 3: AP@10 = 0.9
  - MAP@10 = (0.8 + 0.6 + 0.9) / 3 = 0.77
- **Ý nghĩa:**
  - Metric tổng hợp để đánh giá chất lượng recommendation trên toàn bộ users.

### 5. **NDCG@K (Normalized Discounted Cumulative Gain@K)**
- **Định nghĩa:** Đo chất lượng ranking với discount factor cho vị trí thấp hơn.
- **Công thức:**
      ```
      DCG@K = Σ(relevance_i / log2(i + 1))  với i từ 1 đến K
      IDCG@K = DCG@K lý tưởng (tất cả relevant items ở top)
      NDCG@K = DCG@K / IDCG@K
      ```
- **Ví dụ:**
  - Recommendations: [A(relevant), B(not), C(relevant), D(not), E(relevant)]
  - DCG@5 = 1/log2(2) + 0/log2(3) + 1/log2(4) + 0/log2(5) + 1/log2(6)
        = 1/1 + 0 + 1/2 + 0 + 1/2.58 = 1 + 0.5 + 0.39 = 1.89
  - IDCG@5 (nếu tất cả relevant ở top): 1/1 + 1/1.58 + 1/2 = 1 + 0.63 + 0.5 = 2.13
  - NDCG@5 = 1.89 / 2.13 = 0.89
- **Ý nghĩa:**
  - Cao (0.7-1.0): Ranking tốt, relevant items ở top
  - Trung bình (0.3-0.7): Relevant items ở giữa danh sách
  - Thấp (<0.3): Relevant items ở cuối hoặc không có

### 6. **Coverage (Ground Truth Coverage)**
- **Định nghĩa:** Tỷ lệ items trong ground truth được recommend ít nhất 1 lần.
- **Công thức:**
      ```
      Coverage = (Số items trong ground truth được recommend) / (Tổng số items trong ground truth) × 100%
      ```
- **Ví dụ:**
  - Ground Truth có 1000 unique items
  - Có 750 items được recommend ít nhất 1 lần
  - Coverage = 750/1000 = 75%
- **Ý nghĩa:**
  - Cao (>70%): Hệ thống recommend được nhiều items khác nhau
  - Trung bình (40-70%): Một số items không được recommend
  - Thấp (<40%): Nhiều items không được recommend (có thể do cold-start hoặc bias)

### 7. **Catalog Coverage**
- **Định nghĩa:** Tỷ lệ unique items trong catalog được recommend.
- **Công thức:**
      ```
      Catalog Coverage = (Số unique items được recommend) / (Tổng số items trong catalog) × 100%
      ```
- **Ví dụ:**
  - Catalog có 10,000 posts
  - Có 2,000 unique posts được recommend
  - Catalog Coverage = 2000/10000 = 20%
- **Ý nghĩa:**
  - Cao (>30%): Hệ thống recommend đa dạng, không chỉ focus vào popular items
  - Trung bình (10-30%): Có một số diversity
  - Thấp (<10%): Hệ thống chỉ recommend một số items nhất định (có thể là popular items)

### 8. **Diversity (Category Diversity)**
- **Định nghĩa:** Độ đa dạng về categories trong recommendations của mỗi user.
- **Công thức:**
      ```
      Category Diversity = (Số unique categories) / min(số recommendations, K)
      ```
- **Ví dụ:**
  - Recommendations có 10 posts
  - Posts thuộc 7 categories khác nhau
  - Category Diversity = 7/10 = 0.7 (70%)
- **Ý nghĩa:**
  - Cao (>30%): Hệ thống recommend đa dạng, không chỉ focus vào popular items
  - Trung bình (10-30%): Có một số diversity
  - Thấp (<10%): Hệ thống chỉ recommend một số items nhất định (có thể là popular items)

### 9. **Diversity (Author Diversity)**
- **Định nghĩa:** Độ đa dạng về authors trong recommendations của mỗi user.
- **Công thức:**
      ```
      Author Diversity = (Số unique authors) / min(số recommendations, K)
      ```
- **Ví dụ:**
  - Recommendations có 10 posts
  - Posts từ 5 authors khác nhau
  - Author Diversity = 5/10 = 0.5 (50%)
- **Ý nghĩa:**
  - Cao (>60%): Hệ thống recommend đa dạng, không chỉ focus vào popular items
  - Trung bình (30-60%): Có một số diversity
  - Thấp (<30%): Recommendations tập trung vào một vài authors

### 10. **Đánh giá kết quả**
Trong phần đánh giá, em sử dụng offline evaluation với Top-K = 20, tập trung so sánh CBF, CF và mô hình Hybrid.

Về accuracy, các chỉ số như Precision@20 và Recall@20 tương đối thấp. Tuy nhiên, điều này là phù hợp với mục tiêu discovery, vì hệ thống không tối ưu cá nhân hóa thuần mà ưu tiên khám phá nội dung mới.

Khi xét các metric quan trọng hơn cho discovery, mô hình Hybrid cho kết quả nổi bật nhất. Cụ thể, Hybrid đạt Overall Diversity 67.63% và Category Diversity 35.26%, cao hơn CBF và tương đương hoặc tốt hơn CF, trong khi vẫn giữ mức relevance chấp nhận được.

Kết quả này cho thấy mô hình Hybrid cân bằng tốt giữa relevance và exploration, giúp mở rộng long-tail và tránh lặp nội dung phổ biến. Do đó, hệ thống phù hợp để triển khai cho feed khám phá hoặc trending, nơi diversity và coverage quan trọng hơn accuracy tuyệt đối.

## Slide 16: Conclusion