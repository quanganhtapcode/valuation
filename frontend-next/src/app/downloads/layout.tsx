import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tải Dữ Liệu Tài Chính Cổ Phiếu Việt Nam (Excel/CSV)',
  description:
    'Tải xuống báo cáo tài chính, dữ liệu định giá và dữ liệu thị trường cổ phiếu Việt Nam dạng Excel hoặc CSV: kết quả kinh doanh, bảng cân đối kế toán, lưu chuyển tiền tệ và các chỉ số tài chính.',
  keywords: [
    'tải dữ liệu chứng khoán Việt Nam',
    'báo cáo tài chính Excel',
    'dữ liệu cổ phiếu CSV',
    'vietnam stock data download',
    'vietnam financial data excel',
    'stock financial statements download',
    'vietnam stock csv',
    'download financial data vietnam',
  ],
  alternates: { canonical: '/downloads' },
  openGraph: {
    title: 'Tải Dữ Liệu Tài Chính Cổ Phiếu Việt Nam | Quang Anh',
    description:
      'Xuất báo cáo tài chính và dữ liệu định giá cổ phiếu Việt Nam sang Excel hoặc CSV.',
    url: '/downloads',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tải Dữ Liệu Tài Chính Cổ Phiếu Việt Nam | Quang Anh',
    description:
      'Xuất báo cáo tài chính, dữ liệu định giá và thị trường cổ phiếu Việt Nam sang Excel/CSV.',
  },
};

export default function DownloadsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
