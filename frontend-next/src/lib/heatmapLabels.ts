import type { Lang } from '@/lib/translations';

// The heatmap API groups by Vietnamese ICB sector names.
const sectorNamesEn: Record<string, string> = {
    'Ngân hàng': 'Banks',
    'Bất động sản': 'Real Estate',
    'Thực phẩm và đồ uống': 'Food & Beverage',
    'Dịch vụ tài chính': 'Financial Services',
    'Điện, nước & xăng dầu khí đốt': 'Utilities & Energy',
    'Du lịch và Giải trí': 'Travel & Leisure',
    'Dầu khí': 'Oil & Gas',
    'Hóa chất': 'Chemicals',
    'Tài nguyên Cơ bản': 'Basic Resources',
    'Hàng & Dịch vụ Công nghiệp': 'Industrial Goods & Services',
    'Xây dựng và Vật liệu': 'Construction & Materials',
    'Bán lẻ': 'Retail',
    'Công nghệ Thông tin': 'Technology',
    'Bảo hiểm': 'Insurance',
    'Hàng cá nhân & Gia dụng': 'Personal & Household Goods',
    'Viễn thông': 'Telecommunications',
    'Y tế': 'Health Care',
    'Tiện ích cộng đồng': 'Utilities',
    'Khác': 'Other',
};

export function heatmapSectorName(name: string, lang: Lang, vietnameseShortName?: string): string {
    return lang === 'en' ? (sectorNamesEn[name] ?? name) : (vietnameseShortName ?? name);
}
