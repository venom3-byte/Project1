// مستويات الجودة. الترميز بمعدل ثابت (CBR) فيكون الاستهلاك ثابتاً تقريباً.
// القياس الفعلي لـ ffmpeg أعلى من الحساب النظري بنحو 6-9% (ترويسات MP4 وكلفة المفاتيح)،
// لذلك خفضنا معدلات الفيديو حتى تقترب النتيجة المقاسة من الهدف وتبقى تحت 50MB مع هامش.
//   توفير   : (40 + 16) kbps  ≈ 27 MB/ساعة (مقاس ≈ 28-29)
//   متوازن  : (78 + 16) kbps  ≈ 42-44 MB/ساعة (مقاس ≈ 45-46)  ← الافتراضي
//   عالٍ    : (2200 + 48) kbps ≈ 1 GB/ساعة (يتجاوز 50MB، ولذلك يتوقف تلقائياً عند الحد)
export const PROFILES = {
  saver: {
    id: 'saver', label: 'توفير', width: 640, height: 360, fps: 12,
    videoKbps: 40, audioKbps: 16, level: '3.0', codec: 'avc1.42E01E',
  },
  balanced: {
    id: 'balanced', label: 'متوازن', width: 854, height: 480, fps: 15,
    videoKbps: 78, audioKbps: 16, level: '3.0', codec: 'avc1.42E01E',
  },
  high: {
    id: 'high', label: 'عالٍ', width: 1280, height: 720, fps: 24,
    videoKbps: 2200, audioKbps: 48, level: '3.1', codec: 'avc1.42E01F',
  },
};

export const DEFAULT_PROFILE = 'balanced';

export function getProfile(id) {
  return PROFILES[id] || null;
}

// الاستهلاك المتوقع بالميغابايت في الساعة لمستوى معيّن (تقريبي، بدون حمل HTTP/WS)
export const MEASURED_OVERHEAD = 1.07; // معامل تصحيح من القياس الفعلي
export function expectedMbPerHour(profile) {
  return (((profile.videoKbps + profile.audioKbps) * 1000 * 3600) / 8 / 1e6) * MEASURED_OVERHEAD;
}

// نوع MIME المستخدم في MediaSource على الهاتف
export function mimeFor(profile, audioCodec) {
  const audio = audioCodec === 'aac' ? 'mp4a.40.2' : 'opus';
  return `video/mp4; codecs="${profile.codec},${audio}"`;
}
