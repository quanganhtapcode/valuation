import type { Lang } from '@/lib/translations';

export type LegalDocumentId = 'disclaimer' | 'terms' | 'privacy';

type LegalSection = {
    id: string;
    title: string;
    paragraphs?: string[];
    bullets?: string[];
    important?: string;
};

export type LegalDocumentCopy = {
    eyebrow: string;
    title: string;
    accent: string;
    intro: string;
    updated: string;
    readingTime: string;
    summaryLabel: string;
    summary: string;
    toc: string;
    contact: string;
    nav: Record<LegalDocumentId, string>;
    sections: LegalSection[];
};

const commonVi = {
    eyebrow: 'PHÁP LÝ & MINH BẠCH',
    updated: 'Cập nhật lần cuối: 12 tháng 8, 2026',
    readingTime: 'Khoảng 6 phút đọc',
    summaryLabel: 'Tóm tắt nhanh',
    toc: 'Nội dung',
    contact: 'Cần trao đổi? Liên hệ contact@quanganh.org.',
    nav: { disclaimer: 'Miễn trừ trách nhiệm', terms: 'Điều khoản', privacy: 'Quyền riêng tư' },
};

const commonEn = {
    eyebrow: 'LEGAL & TRANSPARENCY',
    updated: 'Last updated: August 12, 2026',
    readingTime: 'About 6 minutes',
    summaryLabel: 'Quick summary',
    toc: 'On this page',
    contact: 'Questions? Contact contact@quanganh.org.',
    nav: { disclaimer: 'Disclaimer', terms: 'Terms', privacy: 'Privacy' },
};

export const legalContent: Record<Lang, Record<LegalDocumentId, LegalDocumentCopy>> = {
    vi: {
        disclaimer: {
            ...commonVi,
            title: 'Tuyên bố', accent: 'miễn trừ trách nhiệm',
            intro: 'Các giới hạn quan trọng khi sử dụng dữ liệu thị trường, công cụ định giá và nội dung phân tích trên nền tảng.',
            summary: 'Nền tảng phục vụ mục đích thông tin và nghiên cứu, không phải khuyến nghị đầu tư. Dữ liệu và kết quả mô hình có thể sai, thiếu hoặc chậm; bạn phải tự kiểm chứng và tự chịu trách nhiệm với quyết định của mình.',
            sections: [
                { id: 'scope', title: '1. Phạm vi áp dụng', paragraphs: ['Tuyên bố này áp dụng cho stock.quanganh.org, các nguồn dữ liệu, biểu đồ, bộ lọc, mô hình định giá, nội dung AI và dịch vụ liên quan do Quang Anh cung cấp. Khi tiếp tục sử dụng nền tảng, bạn xác nhận đã đọc và chấp nhận các giới hạn dưới đây.'] },
                { id: 'not-advice', title: '2. Không phải tư vấn đầu tư', important: 'Không nội dung nào trên nền tảng là lời mời, khuyến nghị mua, bán hoặc nắm giữ chứng khoán.', paragraphs: ['Nền tảng không tạo quan hệ tư vấn, môi giới, ủy thác hay nghĩa vụ quản lý tài sản. Nội dung không xét đến tình hình tài chính, mục tiêu, thời hạn đầu tư hoặc khả năng chịu rủi ro riêng của bạn.', 'Bạn nên thực hiện thẩm định độc lập và tham khảo chuyên gia được cấp phép trước khi đưa ra quyết định tài chính quan trọng.'] },
                { id: 'data', title: '3. Dữ liệu và độ chính xác', paragraphs: ['Dữ liệu có thể đến từ sở giao dịch, đơn vị cung cấp bên thứ ba, tài liệu doanh nghiệp và quy trình tổng hợp tự động. Dù chúng tôi cố gắng kiểm tra chất lượng, dữ liệu có thể chậm, thiếu, trùng lặp hoặc sai do nguồn hay quá trình xử lý.'], bullets: ['Luôn đối chiếu với công bố chính thức của doanh nghiệp và sở giao dịch.', 'Dữ liệu thời gian thực có thể có độ trễ.', 'Giá, báo cáo và sự kiện quá khứ có thể được điều chỉnh sau khi công bố.'] },
                { id: 'models', title: '4. Mô hình định giá và nội dung AI', paragraphs: ['DCF, FCFE, FCFF, P/E, P/B, mô hình Graham, dự báo và phân tích AI phụ thuộc vào dữ liệu đầu vào và giả định. Kết quả là kịch bản tham khảo, không phải giá trị chắc chắn hay dự đoán hiệu suất tương lai.'], bullets: ['Thay đổi nhỏ về tăng trưởng, lãi suất chiết khấu hoặc biên lợi nhuận có thể làm kết quả thay đổi lớn.', 'Nội dung AI có thể thiếu ngữ cảnh hoặc diễn giải sai nguồn.', 'Người dùng cần đọc phương pháp, giả định và mức độ đầy đủ dữ liệu trước khi sử dụng kết quả.'] },
                { id: 'risk', title: '5. Rủi ro thị trường', important: 'Đầu tư chứng khoán có thể dẫn đến mất một phần hoặc toàn bộ vốn.', paragraphs: ['Hiệu suất trong quá khứ không bảo đảm kết quả tương lai. Giá và thanh khoản có thể biến động mạnh do thị trường, doanh nghiệp, chính sách, tỷ giá hoặc các sự kiện ngoài dự kiến.'] },
                { id: 'liability', title: '6. Giới hạn trách nhiệm', paragraphs: ['Trong phạm vi pháp luật cho phép, Quang Anh không chịu trách nhiệm đối với tổn thất phát sinh từ việc sử dụng hoặc không thể sử dụng nền tảng, dựa vào dữ liệu, gián đoạn dịch vụ, liên kết bên thứ ba hoặc quyết định đầu tư của người dùng. Không điều khoản nào loại trừ trách nhiệm không thể loại trừ theo pháp luật áp dụng.'] },
                { id: 'changes', title: '7. Thay đổi và liên hệ', paragraphs: ['Nội dung có thể được cập nhật khi dịch vụ, nguồn dữ liệu hoặc yêu cầu pháp lý thay đổi. Phiên bản đăng trên trang này là phiên bản hiện hành.'], important: commonVi.contact },
            ],
        },
        terms: {
            ...commonVi,
            title: 'Điều khoản', accent: 'sử dụng',
            intro: 'Quy tắc truy cập và sử dụng dữ liệu, công cụ nghiên cứu và nội dung trên nền tảng.',
            summary: 'Bạn có thể sử dụng nền tảng cho mục đích cá nhân và nghiên cứu hợp pháp. Không được khai thác dữ liệu tự động quy mô lớn, can thiệp hệ thống, sao chép hoặc phân phối lại nội dung khi chưa được chấp thuận.',
            sections: [
                { id: 'acceptance', title: '1. Chấp nhận điều khoản', paragraphs: ['Bằng việc truy cập hoặc sử dụng nền tảng, bạn đồng ý với Điều khoản này, Chính sách quyền riêng tư và Tuyên bố miễn trừ trách nhiệm. Nếu không đồng ý, bạn phải ngừng sử dụng dịch vụ.'] },
                { id: 'service', title: '2. Phạm vi dịch vụ', paragraphs: ['Dịch vụ bao gồm dữ liệu thị trường, báo cáo tài chính, tin tức, bộ lọc, mô hình định giá, xuất dữ liệu và các tính năng được bổ sung theo thời gian. Chúng tôi có thể thay đổi, tạm dừng hoặc ngừng một phần dịch vụ để bảo trì, bảo mật hoặc điều chỉnh sản phẩm.'] },
                { id: 'license', title: '3. Quyền sử dụng', paragraphs: ['Bạn được cấp quyền có giới hạn, không độc quyền, không chuyển nhượng để sử dụng nền tảng cho mục đích cá nhân, giáo dục, nghiên cứu và phi thương mại, phù hợp với pháp luật.'] },
                { id: 'prohibited', title: '4. Hành vi bị cấm', bullets: ['Thu thập tự động, crawl hoặc tải dữ liệu hàng loạt ngoài các chức năng được cung cấp.', 'Vượt qua giới hạn truy cập, kiểm soát bảo mật hoặc cố gắng truy cập trái phép.', 'Sao chép, bán, cấp phép lại hoặc phân phối lại dữ liệu và nội dung khi chưa có văn bản chấp thuận.', 'Dùng dịch vụ để thao túng thị trường, gian lận, phát tán mã độc hoặc xâm phạm quyền của người khác.', 'Mạo danh Quang Anh hoặc tạo ấn tượng rằng nội dung của bạn được nền tảng bảo chứng.'] },
                { id: 'data-ip', title: '5. Dữ liệu và sở hữu trí tuệ', paragraphs: ['Giao diện, mã nguồn, thiết kế, phương pháp trình bày và nội dung do Quang Anh tạo ra được bảo vệ theo pháp luật. Dữ liệu bên thứ ba vẫn thuộc quyền của nguồn tương ứng và có thể chịu điều kiện sử dụng riêng. Việc tải dữ liệu không chuyển giao quyền sở hữu cho người dùng.'] },
                { id: 'availability', title: '6. Tính sẵn sàng và bảo đảm', paragraphs: ['Dịch vụ được cung cấp trên cơ sở “như hiện có”. Chúng tôi không bảo đảm nền tảng luôn liên tục, không lỗi hoặc phù hợp với mọi mục đích. Giới hạn trách nhiệm và rủi ro đầu tư được quy định chi tiết tại Tuyên bố miễn trừ trách nhiệm.'] },
                { id: 'termination', title: '7. Tạm ngừng và chấm dứt', paragraphs: ['Chúng tôi có thể hạn chế hoặc chấm dứt quyền truy cập khi có dấu hiệu vi phạm điều khoản, gây rủi ro bảo mật, ảnh hưởng hệ thống hoặc theo yêu cầu pháp luật. Các nghĩa vụ về sở hữu trí tuệ, giới hạn trách nhiệm và giải quyết tranh chấp tiếp tục có hiệu lực sau khi chấm dứt.'] },
                { id: 'law', title: '8. Luật áp dụng, thay đổi và liên hệ', paragraphs: ['Điều khoản được điều chỉnh theo pháp luật Việt Nam. Chúng tôi có thể cập nhật điều khoản và sẽ công bố ngày hiệu lực trên trang này. Việc tiếp tục sử dụng sau khi cập nhật được xem là chấp nhận phiên bản mới.'], important: commonVi.contact },
            ],
        },
        privacy: {
            ...commonVi,
            title: 'Chính sách', accent: 'quyền riêng tư',
            intro: 'Cách nền tảng xử lý thông tin kỹ thuật, tùy chọn trình duyệt và yêu cầu liên quan đến dữ liệu cá nhân.',
            summary: 'Nền tảng lưu ngôn ngữ, giao diện và watchlist trên trình duyệt. Dữ liệu kỹ thuật tối thiểu có thể được xử lý để vận hành và bảo vệ dịch vụ. Thông tin bạn chủ động gửi chỉ được dùng để phản hồi và hỗ trợ.',
            sections: [
                { id: 'scope', title: '1. Phạm vi chính sách', paragraphs: ['Chính sách này áp dụng khi bạn truy cập stock.quanganh.org, sử dụng công cụ, tải dữ liệu hoặc liên hệ với chúng tôi. Chính sách không kiểm soát hoạt động của các trang hoặc nhà cung cấp dữ liệu bên thứ ba.'] },
                { id: 'collection', title: '2. Thông tin được xử lý', bullets: ['Tùy chọn lưu cục bộ như ngôn ngữ, giao diện sáng/tối và danh sách theo dõi.', 'Thông tin kỹ thuật cần thiết để truyền tải và bảo vệ dịch vụ, như địa chỉ IP, loại trình duyệt, thời gian truy cập và log lỗi.', 'Nội dung bạn chủ động gửi qua email hoặc kênh hỗ trợ.', 'Thông tin tổng hợp hoặc ẩn danh về hiệu năng và cách tính năng được sử dụng.'] },
                { id: 'purpose', title: '3. Mục đích sử dụng', bullets: ['Cung cấp, duy trì và cải thiện nền tảng.', 'Ghi nhớ tùy chọn và cá nhân hóa trải nghiệm trên thiết bị.', 'Phát hiện lỗi, lạm dụng, tấn công và sự cố bảo mật.', 'Phản hồi yêu cầu hỗ trợ và thực hiện nghĩa vụ pháp lý.'] },
                { id: 'storage', title: '4. Lưu trữ trên trình duyệt', paragraphs: ['Ngôn ngữ, theme và watchlist hiện được lưu trong localStorage hoặc cookie trên thiết bị. Bạn có thể xóa chúng trong phần cài đặt trình duyệt. Việc xóa có thể đặt lại tùy chọn nhưng không ngăn bạn sử dụng các chức năng công khai.'] },
                { id: 'sharing', title: '5. Chia sẻ và nhà cung cấp dịch vụ', paragraphs: ['Chúng tôi không bán dữ liệu cá nhân. Thông tin có thể được xử lý bởi nhà cung cấp hạ tầng, hosting, bảo mật hoặc phân tích kỹ thuật trong phạm vi cần thiết để vận hành dịch vụ, hoặc được cung cấp khi pháp luật yêu cầu.'], bullets: ['Frontend được phân phối qua Vercel.', 'Backend và dữ liệu ứng dụng có thể được xử lý trên hạ tầng máy chủ của chúng tôi.', 'Liên kết hoặc nguồn dữ liệu bên thứ ba có chính sách riêng.'] },
                { id: 'security', title: '6. Bảo mật và thời hạn lưu giữ', paragraphs: ['Chúng tôi áp dụng biện pháp kỹ thuật và tổ chức hợp lý, nhưng không hệ thống truyền tải hoặc lưu trữ nào an toàn tuyệt đối. Dữ liệu được giữ trong thời gian cần thiết cho mục đích vận hành, bảo mật, hỗ trợ hoặc tuân thủ pháp luật rồi được xóa hoặc ẩn danh khi phù hợp.'] },
                { id: 'rights', title: '7. Quyền và lựa chọn của bạn', paragraphs: ['Tùy theo pháp luật áp dụng, bạn có thể yêu cầu truy cập, sửa, xóa, hạn chế hoặc phản đối việc xử lý dữ liệu cá nhân đã gửi cho chúng tôi. Chúng tôi có thể cần xác minh danh tính và giữ lại thông tin khi pháp luật hoặc yêu cầu bảo mật bắt buộc.'], bullets: ['Xóa localStorage/cookie trong trình duyệt để đặt lại tùy chọn.', 'Không gửi thông tin nhạy cảm không cần thiết qua email.', 'Liên hệ để thực hiện yêu cầu liên quan đến dữ liệu cá nhân.'] },
                { id: 'changes', title: '8. Trẻ em, thay đổi và liên hệ', paragraphs: ['Dịch vụ không hướng tới trẻ em và chúng tôi không chủ ý thu thập dữ liệu của trẻ em. Chính sách có thể được cập nhật khi sản phẩm hoặc pháp luật thay đổi; ngày cập nhật được ghi ở đầu trang.'], important: commonVi.contact },
            ],
        },
    },
    en: {
        disclaimer: {
            ...commonEn,
            title: 'Platform', accent: 'disclaimer',
            intro: 'Important limits when using market data, valuation tools, and analysis available through the platform.',
            summary: 'The platform is provided for information and research, not investment advice. Data and model outputs may be inaccurate, incomplete, or delayed; you must verify information and remain responsible for your decisions.',
            sections: [
                { id: 'scope', title: '1. Scope', paragraphs: ['This disclaimer applies to stock.quanganh.org and all related data feeds, charts, screeners, valuation models, AI content, and services provided by Quang Anh. By continuing to use the platform, you acknowledge and accept the limitations below.'] },
                { id: 'not-advice', title: '2. Not investment advice', important: 'Nothing on the platform is an offer or recommendation to buy, sell, or hold any security.', paragraphs: ['The platform does not create an advisory, brokerage, fiduciary, or asset-management relationship. Content does not account for your financial circumstances, objectives, investment horizon, or risk tolerance.', 'Conduct independent due diligence and consult a licensed professional before making a material financial decision.'] },
                { id: 'data', title: '3. Data and accuracy', paragraphs: ['Data may come from exchanges, third-party providers, company filings, and automated processing. Although we apply quality checks, information may be delayed, incomplete, duplicated, or incorrect because of source or processing issues.'], bullets: ['Verify information against official company and exchange disclosures.', 'Real-time feeds may be delayed.', 'Historical prices, reports, and events may be revised after publication.'] },
                { id: 'models', title: '4. Valuation models and AI content', paragraphs: ['DCF, FCFE, FCFF, P/E, P/B, Graham models, forecasts, and AI analysis depend on inputs and assumptions. Outputs are reference scenarios, not guaranteed values or predictions of future performance.'], bullets: ['Small changes in growth, discount rates, or margins may materially change an estimate.', 'AI content may omit context or misinterpret a source.', 'Review methodology, assumptions, and data completeness before relying on an output.'] },
                { id: 'risk', title: '5. Market risk', important: 'Investing in securities can result in the loss of some or all invested capital.', paragraphs: ['Past performance does not guarantee future results. Prices and liquidity may change rapidly due to market, company, policy, currency, or unexpected events.'] },
                { id: 'liability', title: '6. Limitation of liability', paragraphs: ['To the fullest extent permitted by law, Quang Anh is not liable for losses arising from use of or inability to use the platform, reliance on data, service interruption, third-party links, or user investment decisions. Nothing excludes liability that cannot lawfully be excluded.'] },
                { id: 'changes', title: '7. Changes and contact', paragraphs: ['This document may be updated as the service, data sources, or legal requirements change. The version published here is the current version.'], important: commonEn.contact },
            ],
        },
        terms: {
            ...commonEn,
            title: 'Terms of', accent: 'service',
            intro: 'Rules for accessing and using data, research tools, and content available through the platform.',
            summary: 'You may use the platform for lawful personal and research purposes. Large-scale automated extraction, system interference, copying, or redistribution without permission is prohibited.',
            sections: [
                { id: 'acceptance', title: '1. Acceptance', paragraphs: ['By accessing or using the platform, you agree to these Terms, the Privacy Policy, and the Disclaimer. If you do not agree, you must stop using the service.'] },
                { id: 'service', title: '2. Service scope', paragraphs: ['The service includes market data, financial statements, news, screening, valuation models, exports, and features added over time. We may modify, suspend, or discontinue portions of the service for maintenance, security, or product changes.'] },
                { id: 'license', title: '3. Permitted use', paragraphs: ['You receive a limited, non-exclusive, non-transferable right to use the platform for lawful personal, educational, research, and non-commercial purposes.'] },
                { id: 'prohibited', title: '4. Prohibited conduct', bullets: ['Automated scraping, crawling, or bulk extraction outside provided features.', 'Circumventing access limits or security controls, or attempting unauthorized access.', 'Copying, selling, sublicensing, or redistributing data or content without written permission.', 'Using the service for market manipulation, fraud, malware, or infringement of third-party rights.', 'Impersonating Quang Anh or implying that we endorse your content.'] },
                { id: 'data-ip', title: '5. Data and intellectual property', paragraphs: ['The interface, code, design, presentation methods, and original content are protected by law. Third-party data remains subject to its source rights and terms. Downloading data does not transfer ownership to you.'] },
                { id: 'availability', title: '6. Availability and warranties', paragraphs: ['The service is provided “as available.” We do not promise uninterrupted, error-free operation or fitness for every purpose. Investment risks and liability limitations are described in the Disclaimer.'] },
                { id: 'termination', title: '7. Suspension and termination', paragraphs: ['We may restrict or terminate access for suspected violations, security risks, system harm, or legal requirements. Intellectual-property, liability, and dispute provisions survive termination.'] },
                { id: 'law', title: '8. Governing law, changes, and contact', paragraphs: ['These Terms are governed by Vietnamese law. We may update them and will publish the effective date here. Continued use after an update constitutes acceptance of the revised Terms.'], important: commonEn.contact },
            ],
        },
        privacy: {
            ...commonEn,
            title: 'Privacy', accent: 'policy',
            intro: 'How the platform handles technical information, browser settings, and personal-data requests.',
            summary: 'The platform stores language, appearance, and watchlist preferences in your browser. Minimal technical data may be processed to operate and secure the service. Information you send voluntarily is used to respond and provide support.',
            sections: [
                { id: 'scope', title: '1. Scope', paragraphs: ['This policy applies when you visit stock.quanganh.org, use tools, download data, or contact us. It does not govern third-party sites or data providers.'] },
                { id: 'collection', title: '2. Information processed', bullets: ['Local preferences such as language, light/dark appearance, and watchlists.', 'Technical information needed to deliver and secure the service, such as IP address, browser type, access time, and error logs.', 'Information you voluntarily send by email or through support channels.', 'Aggregated or de-identified information about performance and feature usage.'] },
                { id: 'purpose', title: '3. How information is used', bullets: ['Provide, maintain, and improve the platform.', 'Remember settings and personalize the on-device experience.', 'Detect errors, abuse, attacks, and security incidents.', 'Respond to support requests and comply with legal obligations.'] },
                { id: 'storage', title: '4. Browser storage', paragraphs: ['Language, theme, and watchlist preferences are currently stored in localStorage or cookies on your device. You may clear them in browser settings. Clearing them resets preferences but does not prevent access to public features.'] },
                { id: 'sharing', title: '5. Service providers and disclosure', paragraphs: ['We do not sell personal data. Information may be processed by infrastructure, hosting, security, or technical analytics providers as necessary to operate the service, or disclosed where legally required.'], bullets: ['The frontend is delivered through Vercel.', 'Application backend and data may be processed on our server infrastructure.', 'Third-party links and data sources have their own policies.'] },
                { id: 'security', title: '6. Security and retention', paragraphs: ['We use reasonable technical and organizational safeguards, but no transmission or storage system is completely secure. Information is retained as needed for operations, security, support, or legal compliance, then deleted or de-identified where appropriate.'] },
                { id: 'rights', title: '7. Your rights and choices', paragraphs: ['Depending on applicable law, you may request access, correction, deletion, restriction, or objection concerning personal data you submitted. We may verify identity and retain information where law or security requires.'], bullets: ['Clear localStorage or cookies to reset preferences.', 'Do not send unnecessary sensitive information by email.', 'Contact us to submit a personal-data request.'] },
                { id: 'changes', title: '8. Children, changes, and contact', paragraphs: ['The service is not directed to children and we do not knowingly collect children’s data. This policy may change as the product or law evolves; the update date appears at the top.'], important: commonEn.contact },
            ],
        },
    },
};
