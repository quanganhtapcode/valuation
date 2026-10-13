// Format uppercase source labels for display while retaining fund and company names.
const properNames = [
    'An Bình', 'Thịnh Vượng', 'Bảo Việt', 'Bản Việt', 'Việt Nam', 'Phú Hưng',
    'Rồng Vàng', 'Rồng Việt', 'Thành Công', 'Đại Chúng', 'Công Thương',
    'Mirae Asset', 'Mirea Asset', 'Bordier', 'Flagship', 'Ballad', 'Dragon Capital',
    'VinaCapital', 'Vietcombank', 'VietinBank', 'Eastspring Investments', 'Manulife',
    'Investment', 'Lighthouse', 'Amber', 'United', 'Asset Management', 'Partner',
    'Daiichi Life', 'Discovery', 'Capital', 'TNHH', 'MTV', 'TMCP',
    'VCBF', 'DFVN', 'PVCOM', 'SSI', 'SGI', 'ESG', 'UOB', 'IPA', 'VND',
    'LPB', 'NTP', 'KIM', 'MB', 'DC', 'HD', 'LP',
];

export function formatFundDisplayName(value: string): string {
    const trimmed = value.trim();
    if (trimmed !== trimmed.toLocaleUpperCase('vi-VN')) return trimmed;
    let formatted = trimmed.toLocaleLowerCase('vi-VN');
    for (const name of properNames) {
        formatted = formatted.replace(
            new RegExp(`(?<![\\p{L}\\p{N}])${name.toLocaleLowerCase('vi-VN')}(?![\\p{L}\\p{N}])`, 'gu'),
            name,
        );
    }
    return formatted.charAt(0).toLocaleUpperCase('vi-VN') + formatted.slice(1);
}
