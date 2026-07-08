// Đánh giá / NPS sau tour — logic thuần (phân loại NPS, phát hiện đánh giá tệ, tổng hợp),
// tách khỏi route để test được + dùng chung cho báo cáo.
// stars: 1..5 (bắt buộc) · nps: 0..10 (tuỳ chọn "khả năng giới thiệu bạn bè").

// NPS chuẩn: 9-10 Promoter, 7-8 Passive, 0-6 Detractor
function npsCategory(nps) {
  if (nps == null) return null;
  if (nps >= 9) return 'PROMOTER';
  if (nps >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

// Đánh giá "tệ" cần follow-up: ≤2 sao HOẶC NPS detractor → đóng vòng dịch vụ khách hàng
function isNegative(r) {
  if (Number(r.stars) <= 2) return true;
  if (r.nps != null && Number(r.nps) <= 6) return true;
  return false;
}

// Tổng hợp 1 tập review → điểm trung bình sao + chỉ số NPS + phân bố sao
function computeStats(reviews) {
  const count = reviews.length;
  if (!count) return { count: 0, avgStars: null, npsScore: null, promoters: 0, passives: 0, detractors: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, npsCount: 0 };
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let starSum = 0, promoters = 0, passives = 0, detractors = 0, npsCount = 0;
  for (const r of reviews) {
    const s = Math.min(5, Math.max(1, Number(r.stars) || 0));
    distribution[s]++; starSum += s;
    const cat = npsCategory(r.nps);
    if (cat) { npsCount++; if (cat === 'PROMOTER') promoters++; else if (cat === 'PASSIVE') passives++; else detractors++; }
  }
  return {
    count,
    avgStars: Math.round(starSum / count * 10) / 10,
    // NPS = %promoter − %detractor (−100..100), chỉ tính trên review có nhập NPS
    npsScore: npsCount ? Math.round((promoters - detractors) / npsCount * 100) : null,
    npsCount, promoters, passives, detractors, distribution,
  };
}

function genReviewId() { return 'REV-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

module.exports = { npsCategory, isNegative, computeStats, genReviewId };
