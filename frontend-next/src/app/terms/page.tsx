import styles from './page.module.css';

export const metadata = {
    title: 'Terms of Service',
    description: 'Terms of Service for the Quang Anh stock analysis platform.',
    alternates: { canonical: '/terms' },
};

export default function TermsPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Terms of Service</h1>
            <div className={styles.lastUpdated}>Last updated: March 23, 2026 &mdash; Effective immediately upon publication</div>

            <div className={styles.content}>

                <section className={styles.section}>
                    <h2>1. Introduction and Acceptance</h2>
                    <p>
                        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the stock analysis platform operated by Quang Anh, accessible at <strong>stock.quanganh.org</strong> (the &quot;Platform&quot;), including all associated features, data services, valuation tools, application programming interfaces, and content (collectively, the &quot;Service&quot;).
                    </p>
                    <p>
                        By accessing or using any part of the Service, you (&quot;User&quot; or &quot;you&quot;) agree to be legally bound by these Terms, our <a href="/privacy" className={styles.link}>Privacy Policy</a>, and our <a href="/disclaimer" className={styles.link}>Disclaimer</a>, all of which are incorporated by reference. If you do not agree to all of these Terms, you are not authorized to access or use the Service and must immediately cease doing so.
                    </p>
                    <p>
                        Quang Anh reserves the right to modify these Terms at any time. Continued use of the Service following the posting of any changes constitutes acceptance of those changes. It is your responsibility to review these Terms periodically.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>2. Definitions</h2>
                    <ul className={styles.list}>
                        <li><strong>&quot;Platform&quot;</strong> means the stock.quanganh.org website and all related sub-pages, tools, and data interfaces.</li>
                        <li><strong>&quot;Service&quot;</strong> means all features, functionalities, data feeds, APIs, and content made available through the Platform.</li>
                        <li><strong>&quot;Market Data&quot;</strong> means price quotations, trading volumes, indices, financial statements, ratios, and other financial or securities-related information provided through the Service.</li>
                        <li><strong>&quot;Content&quot;</strong> means all text, graphics, charts, data tables, valuation outputs, analyses, source code, interface elements, and any other material published on or delivered through the Service.</li>
                        <li><strong>&quot;User&quot;</strong> means any individual or entity that accesses or uses the Service.</li>
                        <li><strong>&quot;Authorized Use&quot;</strong> means personal, non-commercial research and informational access to the Service as described in Section 4.</li>
                        <li><strong>&quot;Prohibited Use&quot;</strong> means any use not expressly permitted under these Terms, as described in Section 5.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>3. Description of Service</h2>
                    <p>
                        Quang Anh is a financial data aggregation and analysis platform focused on the Vietnamese equity markets, covering securities listed on the Ho Chi Minh Stock Exchange (HOSE), the Hanoi Stock Exchange (HNX), and the Unlisted Public Company Market (UPCOM). The Service provides:
                    </p>
                    <ul className={styles.list}>
                        <li>Real-time and delayed market price data, trading volumes, and index levels sourced from licensed data providers including VCI (Viet Capital Securities);</li>
                        <li>Fundamental financial data including income statements, balance sheets, cash flow statements, and financial ratios for approximately 1,700+ listed companies, aggregated from publicly disclosed regulatory filings and third-party data aggregators;</li>
                        <li>Quantitative valuation tools employing methodologies including Discounted Cash Flow to Equity (DCFE/FCFE), Discounted Cash Flow to Firm (DCFF/FCFF), Justified Price-to-Earnings (P/E), and Justified Price-to-Book (P/B) models;</li>
                        <li>Market screening, filtering, and comparative analysis tools;</li>
                        <li>Curated financial news and corporate event information aggregated from publicly available Vietnamese financial media and official disclosure channels;</li>
                        <li>Foreign ownership tracking and institutional holding data where publicly disclosed.</li>
                    </ul>
                    <p>
                        The scope, features, and data coverage of the Service may change over time. Quang Anh reserves the right to modify, suspend, or discontinue any part of the Service with or without notice.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>4. License Grant and Permitted Use</h2>
                    <p>
                        Subject to your compliance with these Terms, Quang Anh grants you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service solely for your own personal, non-commercial informational and research purposes.
                    </p>
                    <p>
                        This license expressly permits you to:
                    </p>
                    <ul className={styles.list}>
                        <li>View, analyze, and interact with Market Data and Content through the Platform&apos;s standard user interface;</li>
                        <li>Use valuation tools to perform calculations and scenario analyses for personal investment research;</li>
                        <li>Download data exports made available through the Platform&apos;s designated download features for personal use only;</li>
                        <li>Share screenshots or limited extracts for educational, journalistic, or personal discussion purposes, provided proper attribution to Quang Anh is given.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>5. Prohibited Uses</h2>
                    <p className={styles.highlight}>
                        Any use of the Service beyond the scope of the Authorized Use described in Section 4 is strictly prohibited without prior written consent from Quang Anh. The following activities are expressly prohibited:
                    </p>
                    <ul className={styles.list}>
                        <li><strong>Automated Data Harvesting:</strong> Using bots, crawlers, scrapers, spiders, scripts, or any automated tool to extract, copy, index, or aggregate any data from the Platform, including but not limited to bulk price data, financial statement data, or screening results.</li>
                        <li><strong>Commercial Redistribution:</strong> Reproducing, republishing, reselling, sublicensing, or commercially distributing any Content or Market Data obtained through the Service, whether in raw, modified, or derived form.</li>
                        <li><strong>API Abuse:</strong> Accessing any backend API endpoints in excess of normal browser usage rates, reverse-engineering API structures for unauthorized programmatic access, or circumventing any rate-limiting or access-control mechanisms.</li>
                        <li><strong>Mirror Sites:</strong> Creating copies, mirrors, or derivative platforms of the Service or substantial portions of the Content.</li>
                        <li><strong>Security Circumvention:</strong> Attempting to probe, scan, or test the vulnerability of the Platform; bypassing authentication or access controls; or introducing malware, denial-of-service attacks, or any other disruptive technology.</li>
                        <li><strong>Unauthorized Framing:</strong> Framing or embedding the Platform or any portion of its Content within another website or application without explicit written permission.</li>
                        <li><strong>Misrepresentation:</strong> Representing that any data, analysis, or valuation output from the Platform constitutes professional financial advice, or using Platform Content in materials that could mislead third parties as to its source, reliability, or professional nature.</li>
                        <li><strong>Illegal Use:</strong> Using the Service to facilitate any unlawful activity under Vietnamese law or applicable international law, including securities fraud, market manipulation, or insider trading.</li>
                    </ul>
                    <p>
                        Violation of these prohibitions may result in immediate termination of your access to the Service and may expose you to civil and/or criminal liability.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>6. Market Data — Delays, Accuracy, and Limitations</h2>
                    <p>
                        Market Data available through the Service is subject to the following limitations, which you acknowledge and accept:
                    </p>
                    <ul className={styles.list}>
                        <li><strong>Data Delays:</strong> Real-time pricing data is subject to transmission and processing delays. Depending on the data source and market session, quotes may be delayed by up to 15–20 minutes. We make no representation that any price quote reflects the actual current market price at the moment of display.</li>
                        <li><strong>Source Dependencies:</strong> The accuracy and completeness of Market Data is dependent on our upstream data providers (including VCI, CafeF, and exchange feeds). We are not responsible for errors, omissions, or interruptions introduced at the source level.</li>
                        <li><strong>Financial Statement Data:</strong> Fundamental data is sourced from official company disclosures filed with the State Securities Commission of Vietnam (SSC) and aggregated by third-party data vendors. Minor discrepancies may exist between our displayed figures and the source documents. Users are encouraged to verify critical figures against official filings.</li>
                        <li><strong>Calculation Methodology:</strong> All valuation model outputs, financial ratios, and screening scores are computed according to Quang Anh&apos;s proprietary methodologies. Different methodologies will produce different results. Users should independently verify calculations using their own methods before relying on them.</li>
                        <li><strong>Corporate Actions:</strong> Historical price data may or may not be adjusted for dividends, stock splits, bonus shares, or rights issues. Check data labels for adjustment status. Unadjusted historical data does not reflect total returns.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>7. Valuation Models and Financial Tools</h2>
                    <p>
                        The valuation models provided on the Platform (FCFE, FCFF, Justified P/E, Justified P/B, and others) are quantitative tools intended to assist in investment research. You acknowledge the following:
                    </p>
                    <ul className={styles.list}>
                        <li>All model outputs are entirely dependent on the input assumptions you supply (growth rates, discount rates, payout ratios, etc.). Different assumptions will produce materially different valuations.</li>
                        <li>No model output should be interpreted as a target price, recommendation to buy or sell, or prediction of future market performance.</li>
                        <li>Valuation models involve inherent simplifications and may not capture all factors relevant to a security&apos;s true intrinsic value, including macroeconomic conditions, management quality, competitive dynamics, and market sentiment.</li>
                        <li>The Platform&apos;s automated weighting of model outputs (e.g., equal-weighted average of FCFE, FCFF, P/E, P/B; P/E and P/B only for banking and financial institutions) represents a default approach that may not be appropriate for all securities or investment styles.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>8. Intellectual Property Rights</h2>
                    <p>
                        All Content on the Platform — including but not limited to: the Platform&apos;s source code, frontend interface design, data pipeline architecture, valuation model implementations, chart visualizations, screening algorithms, compiled financial databases, logo, brand name, and all original text — is the intellectual property of Quang Anh and is protected by applicable copyright, trademark, database right, and trade secret laws.
                    </p>
                    <p>
                        Market Data and financial information displayed on the Platform may be subject to the intellectual property rights of our data providers (including VCI, CafeF, and exchanges). Such data is made available to you under the terms of our agreements with those providers and does not convey any license beyond personal use.
                    </p>
                    <p>
                        Nothing in these Terms transfers any intellectual property rights to you. The limited license in Section 4 is the full extent of your rights to use Platform Content. Any unauthorized reproduction, modification, distribution, display, or creation of derivative works is strictly prohibited and constitutes infringement.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>9. Third-Party Content and Links</h2>
                    <p>
                        The Service may display content, news articles, announcements, and links sourced from third parties, including but not limited to: VCI IQ, CafeF, Vietstock, the State Securities Commission of Vietnam, listed company investor relations pages, and other financial media. Such third-party content is provided for informational context only.
                    </p>
                    <p>
                        Quang Anh does not review, endorse, warrant, or assume responsibility for any third-party content, and is not liable for any loss or damage that may arise from your use of or reliance on it. The inclusion of any third-party link or content reference does not imply a partnership, affiliation, sponsorship, or endorsement relationship.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>10. Disclaimer of Warranties</h2>
                    <p className={styles.highlight}>
                        THE SERVICE, ALL MARKET DATA, CONTENT, AND TOOLS ARE PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT ANY WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, QUANG ANH EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO: (A) WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT; (B) WARRANTIES AS TO THE ACCURACY, COMPLETENESS, TIMELINESS, RELIABILITY, OR AVAILABILITY OF ANY DATA OR CONTENT; (C) WARRANTIES THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE FROM VIRUSES OR OTHER HARMFUL CODE.
                    </p>
                    <p>
                        No information obtained from the Service shall create any warranty not expressly stated in these Terms. Your use of the Service is at your sole risk.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>11. Limitation of Liability</h2>
                    <p>
                        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL QUANG ANH, ITS DEVELOPERS, CONTRIBUTORS, AFFILIATES, OR SERVICE PROVIDERS BE LIABLE FOR ANY:
                    </p>
                    <ul className={styles.list}>
                        <li>Indirect, incidental, special, consequential, punitive, or exemplary damages;</li>
                        <li>Loss of profits, revenue, data, business opportunities, or goodwill;</li>
                        <li>Damages arising from your reliance on Market Data, valuation outputs, or any other Content for investment decisions;</li>
                        <li>Damages arising from service interruptions, data errors, delays, or any inability to access the Service;</li>
                        <li>Damages caused by unauthorized access to or alteration of your transmissions or data;</li>
                    </ul>
                    <p>
                        WHETHER BASED IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY OTHER LEGAL THEORY, EVEN IF QUANG ANH HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. If applicable law does not allow the exclusion or limitation of incidental or consequential damages, the above limitation or exclusion may not apply to you.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>12. Indemnification</h2>
                    <p>
                        You agree to defend, indemnify, and hold harmless Quang Anh and its developers, contributors, and affiliates from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, and fees (including reasonable legal fees) arising out of or relating to: (a) your violation of these Terms; (b) your Prohibited Use of the Service; (c) your use of Market Data or valuation outputs in any investment decision; (d) your infringement of any intellectual property rights of Quang Anh or any third party; or (e) any false or misleading information you provide in connection with your use of the Service.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>13. Service Modifications and Termination</h2>
                    <p>
                        Quang Anh reserves the right, at its sole discretion and at any time, to: (a) modify, suspend, or discontinue any part of the Service, temporarily or permanently, with or without notice; (b) change data coverage, update frequencies, or feature availability; (c) impose usage limits or access restrictions on any part of the Service; or (d) terminate your access to the Service if you breach these Terms. Quang Anh shall not be liable to you or any third party for any modification, suspension, or discontinuation of the Service.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>14. Force Majeure</h2>
                    <p>
                        Quang Anh shall not be liable for any failure or delay in the performance of its obligations under these Terms arising from causes beyond its reasonable control, including but not limited to: acts of God, natural disasters, government actions, exchange or regulatory trading halts, telecommunications or internet outages, cyberattacks, failures of third-party data providers, power failures, or pandemic-related disruptions. In such events, Quang Anh will use commercially reasonable efforts to restore service as promptly as practicable.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>15. Governing Law and Dispute Resolution</h2>
                    <p>
                        These Terms shall be governed by and construed in accordance with the laws of the Socialist Republic of Vietnam, without regard to its conflict of law principles. Any dispute, claim, or controversy arising out of or relating to these Terms or the Service shall first be subject to good-faith negotiation between the parties. If unresolved within 30 days, the dispute shall be submitted to the competent courts of Vietnam.
                    </p>
                    <p>
                        You agree that any claim arising out of or related to the Service must be filed within one (1) year after the cause of action arose, or such claim is permanently barred.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>16. Severability</h2>
                    <p>
                        If any provision of these Terms is found by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions shall continue in full force and effect. The failure of Quang Anh to enforce any right or provision of these Terms shall not constitute a waiver of that right or provision.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>17. Entire Agreement</h2>
                    <p>
                        These Terms, together with the Privacy Policy and Disclaimer, constitute the entire agreement between you and Quang Anh with respect to the Service and supersede all prior agreements, communications, and understandings, whether written or oral, relating to the subject matter hereof.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>18. Contact</h2>
                    <p>
                        For questions, legal notices, or licensing inquiries regarding these Terms:
                    </p>
                    <p>
                        <strong>Email:</strong> <a href="mailto:contact@quanganh.org" className={styles.link}>contact@quanganh.org</a><br />
                        <strong>Website:</strong> <a href="https://stock.quanganh.org" className={styles.link}>stock.quanganh.org</a>
                    </p>
                </section>

            </div>
        </main>
    );
}
