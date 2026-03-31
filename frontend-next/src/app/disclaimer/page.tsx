import styles from './page.module.css';

export const metadata = {
    title: 'Disclaimer',
    description: 'Legal disclaimer regarding information and data on the Quang Anh platform.',
    alternates: { canonical: '/disclaimer' },
};

export default function DisclaimerPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Disclaimer</h1>
            <div className={styles.lastUpdated}>Effective Date: March 23, 2026 &mdash; Please read this notice carefully before using the Service</div>

            <div className={styles.content}>

                <section className={styles.section}>
                    <h2>1. Important Notice — Please Read Carefully</h2>
                    <p className={styles.highlight}>
                        THIS DISCLAIMER CONTAINS IMPORTANT LEGAL INFORMATION LIMITING THE LIABILITY OF QUANG ANH. BY ACCESSING OR USING THIS PLATFORM, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND ACCEPTED ALL TERMS OF THIS DISCLAIMER. IF YOU DO NOT ACCEPT THESE TERMS, YOU MUST CEASE USING THE SERVICE IMMEDIATELY.
                    </p>
                    <p>
                        This Disclaimer applies to the Quang Anh stock analysis platform accessible at <strong>stock.quanganh.org</strong> (the &quot;Platform&quot;), all associated data feeds, valuation tools, screening features, news aggregation, and any content or services provided through the Platform (collectively, the &quot;Service&quot;). This Disclaimer should be read together with our <a href="/terms" className={styles.link}>Terms of Service</a> and <a href="/privacy" className={styles.link}>Privacy Policy</a>.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>2. Not Investment Advice — No Financial Advisory Relationship</h2>
                    <p className={styles.highlight}>
                        ALL INFORMATION, DATA, ANALYSIS, VALUATION OUTPUTS, CHARTS, SCREENING RESULTS, NEWS SUMMARIES, AND ANY OTHER CONTENT AVAILABLE THROUGH THE SERVICE ARE PROVIDED SOLELY FOR GENERAL INFORMATIONAL AND RESEARCH PURPOSES. NOTHING ON THIS PLATFORM CONSTITUTES, OR SHOULD BE CONSTRUED AS, INVESTMENT ADVICE, FINANCIAL ADVICE, TRADING ADVICE, LEGAL ADVICE, TAX ADVICE, OR ANY OTHER FORM OF PROFESSIONAL ADVISORY SERVICE.
                    </p>
                    <p>
                        Quang Anh does not recommend or endorse the purchase, sale, or holding of any specific security, financial instrument, fund, or portfolio strategy. The display of any company&apos;s financial data, valuation estimate, or screening score is not a recommendation to transact in that company&apos;s securities. No content on this Platform should serve as the primary or sole basis for any investment decision.
                    </p>
                    <p>
                        Any decision to buy, sell, hold, or otherwise transact in any financial instrument based on information accessed through this Platform is made entirely at your own discretion, judgment, and risk. You are solely responsible for conducting your own independent due diligence and for the outcome of all investment decisions you make.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>3. Regulatory Status — Not a Licensed Financial Institution</h2>
                    <p>
                        Quang Anh is a financial data technology platform and is not a licensed broker-dealer, investment adviser, financial planner, fund manager, or any other regulated financial institution under Vietnamese law or the laws of any other jurisdiction. Quang Anh is not registered with the State Securities Commission of Vietnam (SSC), the Ministry of Finance of Vietnam, or any equivalent regulatory body in any other country.
                    </p>
                    <p>
                        Nothing in the Service creates a fiduciary, advisory, broker-client, or any other professional relationship between Quang Anh and you. The information provided does not take into account your individual financial situation, investment objectives, risk tolerance, tax circumstances, time horizon, or any other personal circumstances relevant to an investment decision.
                    </p>
                    <p>
                        We strongly recommend that you consult with a licensed and qualified financial advisor, securities broker, or investment professional registered with the SSC or a relevant competent authority before making any investment decision.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>4. Market Risk Warning</h2>
                    <p>
                        Investing in securities involves substantial risk of loss. You should carefully consider the following risk factors:
                    </p>
                    <ul className={styles.list}>
                        <li><strong>Capital Risk:</strong> The value of stocks and other securities can decrease as well as increase. You may receive back less than you invest. There is no guarantee of profit, and you may lose some or all of your invested capital.</li>
                        <li><strong>Market Volatility:</strong> Equity markets, and Vietnamese markets in particular, can be subject to rapid and extreme price fluctuations driven by domestic economic conditions, regulatory changes, geopolitical events, foreign capital flows, and investor sentiment.</li>
                        <li><strong>Liquidity Risk:</strong> Certain securities, particularly those on HNX, UPCOM, or with low average daily trading volume, may be difficult to buy or sell at a favorable price or at all during certain market conditions.</li>
                        <li><strong>Small-Cap and Emerging Market Risk:</strong> Smaller companies and companies in emerging markets like Vietnam may carry elevated risk of financial distress, limited disclosure, governance concerns, and thin trading liquidity compared to large-cap securities in developed markets.</li>
                        <li><strong>Currency Risk:</strong> For investors operating in currencies other than the Vietnamese Dong (VND), fluctuations in exchange rates may materially affect the real returns on investments in Vietnamese securities.</li>
                        <li><strong>Regulatory Risk:</strong> The regulatory environment governing Vietnamese capital markets is evolving. Changes in laws, exchange rules, foreign ownership limits, or government policy can materially affect the value of securities.</li>
                        <li><strong>Concentration Risk:</strong> Focusing analysis or investment in a single sector, industry, or small number of securities increases exposure to sector-specific risks and adverse events.</li>
                    </ul>
                    <p>
                        Past performance of any security, sector, index, or valuation model is not a reliable indicator of future results. Historical data is presented for analytical and educational purposes only and should not be extrapolated as a prediction of future performance.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>5. Data Sources, Accuracy, and Timeliness</h2>
                    <p>
                        Market Data and fundamental financial information displayed on the Platform is aggregated from multiple third-party sources, including but not limited to: Viet Capital Securities (VCI), CafeF, Vietstock, official exchange data feeds from HOSE and HNX, and company filings with the State Securities Commission of Vietnam.
                    </p>
                    <p>
                        Despite our efforts to present accurate, timely, and complete information, we cannot and do not guarantee the accuracy, completeness, reliability, timeliness, or fitness for any purpose of any data displayed on the Platform. Specifically:
                    </p>
                    <ul className={styles.list}>
                        <li><strong>Data Delays:</strong> Real-time price data may be delayed by up to 15–20 minutes depending on the data provider and market session. Data labeled &quot;real-time&quot; or &quot;live&quot; reflects the fastest available feed, which may nonetheless lag actual exchange transactions.</li>
                        <li><strong>Source Errors:</strong> Errors, omissions, and inconsistencies may originate at the level of our upstream data providers or from the original filings. We apply reasonable validation processes but cannot independently verify every data point.</li>
                        <li><strong>Financial Statement Restatements:</strong> Companies may restate previously reported financial results. Restated figures may not be immediately reflected in our database. Users should cross-reference with official company filings for time-sensitive analysis.</li>
                        <li><strong>Corporate Actions:</strong> Historical price series may or may not be adjusted for dividends, rights issues, bonus shares, or stock splits. Unadjusted price histories do not reflect total economic return. Always verify the adjustment basis of any historical series before use.</li>
                        <li><strong>Derived Metrics:</strong> Financial ratios, per-share figures, and composite scores are calculated from raw data and are subject to the compounding effect of any underlying data errors.</li>
                        <li><strong>Coverage Gaps:</strong> Not all listed securities may have complete financial data. Coverage of UPCOM-listed companies and newly listed entities may be less complete than for main-board securities.</li>
                    </ul>
                    <p>
                        By using the Platform, you accept the inherent limitations of financial data aggregation and assume all risk arising from data inaccuracies or delays.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>6. Valuation Model Limitations and Model Risk</h2>
                    <p>
                        The intrinsic valuation models provided on the Platform (including FCFE, FCFF, Justified P/E, and Justified P/B) are quantitative analytical frameworks. Their outputs are inherently subject to model risk and should be interpreted with significant caution:
                    </p>
                    <ul className={styles.list}>
                        <li><strong>Sensitivity to Assumptions:</strong> Valuation outputs are highly sensitive to input assumptions. A small change in the assumed long-term growth rate, terminal growth rate, or discount rate can produce dramatically different intrinsic value estimates. No single set of assumptions is objectively correct.</li>
                        <li><strong>Model Simplification:</strong> Discounted Cash Flow and justified multiple approaches rely on simplifying assumptions about future business performance, capital structure, and cost of capital. Real businesses operate in ways that may deviate substantially from model assumptions.</li>
                        <li><strong>Sector Limitations:</strong> Standard DCF models may be inappropriate for certain industries such as financial services, insurance, real estate, or early-stage companies. The Platform applies adjusted methodologies for banking institutions (P/E and P/B weighted) but may not fully account for all sector-specific nuances.</li>
                        <li><strong>Forward-Looking Nature:</strong> All valuation estimates are inherently forward-looking and based on historical data projected into the future. They are not forecasts or guarantees. Actual business performance may differ materially from projections.</li>
                        <li><strong>Market vs. Intrinsic Value:</strong> An intrinsic value estimate below or above the current market price does not constitute a trading signal. Markets can remain mispriced (relative to model estimates) for extended periods. Intrinsic value is a theoretical construct, not a guaranteed price target.</li>
                        <li><strong>No Qualitative Factors:</strong> The models do not account for qualitative factors such as management quality, brand strength, competitive moat, regulatory exposure, governance issues, or strategic risks — all of which may be material to a company&apos;s true value.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>7. Forward-Looking Statements</h2>
                    <p>
                        Certain content on the Platform may contain forward-looking statements, estimates, projections, targets, or opinions about future events or conditions. Such statements are based on assumptions and involve known and unknown risks and uncertainties. Actual results may differ materially from any future results expressed or implied by forward-looking content. Words such as &quot;estimate,&quot; &quot;project,&quot; &quot;forecast,&quot; &quot;expect,&quot; &quot;may,&quot; &quot;could,&quot; or similar language identify forward-looking statements and should be interpreted with appropriate skepticism. Quang Anh undertakes no obligation to update or revise any forward-looking statements in response to new information, future events, or otherwise.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>8. No Representation of Completeness or Suitability</h2>
                    <p>
                        The information and tools on the Platform are designed to assist in financial research and analysis. They are not designed to meet any individual user&apos;s specific investment needs, financial situation, or risk profile. The Service does not consider your personal tax circumstances, legal constraints, investment horizon, liquidity needs, or any regulatory requirements applicable to you.
                    </p>
                    <p>
                        Any reference to specific securities, sectors, or market events is made solely for illustrative or analytical purposes. It does not imply that any security mentioned is suitable for any particular investor. Suitability of any investment depends on individual circumstances that only a qualified financial advisor familiar with your personal situation can properly assess.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>9. Technology and Service Availability Risk</h2>
                    <p>
                        The Platform is provided on a best-efforts basis. Quang Anh does not guarantee uninterrupted availability of the Service. Service disruptions may occur due to scheduled maintenance, server failures, cyberattacks, internet outages, data provider failures, or other technical events. Quang Anh shall not be liable for any loss or damage arising from your inability to access the Service or from delays, errors, or interruptions in data delivery during critical market periods, including but not limited to market opens, closes, auction periods, or periods of high volatility.
                    </p>
                    <p>
                        Users who require guaranteed, real-time data access for time-sensitive trading decisions should not rely on this Platform as their sole or primary data source and should subscribe to professional-grade market data services from licensed providers.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>10. Third-Party News and Information</h2>
                    <p>
                        The Service aggregates news articles, company announcements, analyst commentary, and other information from third-party sources for informational convenience. Quang Anh does not independently verify, fact-check, or endorse any third-party content. Such content reflects the views of the original source authors and should not be attributed to Quang Anh. Quang Anh makes no representation regarding the accuracy, completeness, or timeliness of third-party news or analysis. Users should exercise their own judgment when evaluating any news item or external commentary displayed on the Platform.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>11. User Responsibility and Assumption of Risk</h2>
                    <p>
                        By using this Platform, you expressly acknowledge and agree that:
                    </p>
                    <ul className={styles.list}>
                        <li>You use the Service and any information derived from it entirely at your own risk;</li>
                        <li>You have the knowledge, experience, and sophistication to evaluate the information provided and to make independent investment judgments;</li>
                        <li>Quang Anh, its developers, contributors, and affiliates shall not be held responsible or liable — directly or indirectly — for any financial loss, trading loss, or any other harm incurred as a result of your use of or reliance on any information, data, tool, or content available through the Service;</li>
                        <li>You will independently verify any information material to your investment decisions and will seek professional financial advice appropriate to your specific circumstances before executing any transaction.</li>
                    </ul>
                </section>

                <section className={styles.section}>
                    <h2>12. Governing Law</h2>
                    <p>
                        This Disclaimer is governed by and shall be construed in accordance with the laws of the Socialist Republic of Vietnam. Any disputes arising from or in connection with this Disclaimer shall be subject to the exclusive jurisdiction of the competent courts of Vietnam.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>13. Contact</h2>
                    <p>
                        If you have questions about this Disclaimer or believe there is a material data error on the Platform that should be corrected, please contact us:
                    </p>
                    <p>
                        <strong>Email:</strong> <a href="mailto:contact@quanganh.org" className={styles.link}>contact@quanganh.org</a><br />
                        <strong>Website:</strong> <a href="https://stock.quanganh.org" className={styles.link}>stock.quanganh.org</a>
                    </p>
                    <p>
                        We take data accuracy seriously and will investigate credible reports of significant data errors on a best-efforts basis. However, we do not guarantee any specific response time or corrective action, and we assume no liability for losses incurred prior to any correction being made.
                    </p>
                </section>

            </div>
        </main>
    );
}
