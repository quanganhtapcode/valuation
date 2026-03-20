import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/Navbar";
import Footer from "@/components/ui/Footer";
import { ThemeProvider } from "next-themes";
import { TickerTape } from "@/components/TickerTape";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { siteConfig } from "@/app/siteConfig";
import { WatchlistProvider } from "@/lib/watchlistContext";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "Quang Anh | Vietnam Stock Analysis & Valuation",
    template: "%s | Quang Anh",
  },
  description: siteConfig.description,
  keywords: [
    "vietnam stock market", "stock analysis", "stock valuation", "vnindex",
    "vn30", "dcf valuation", "financial analysis", "market heatmap",
    "hose", "hnx", "upcom", "pe ratio", "pb ratio",
  ],
  authors: [{ name: "Quang Anh", url: siteConfig.url }],
  creator: "Quang Anh",
  publisher: "Quang Anh",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
  },
  openGraph: {
    title: "Quang Anh | Vietnam Stock Analysis & Valuation",
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: "Quang Anh",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quang Anh | Vietnam Stock Analysis",
    description: siteConfig.description,
    creator: "@quanganh",
  },
  alternates: {
    canonical: siteConfig.url,
  },
  verification: {
    google: "", // add Google Search Console verification token here
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Quang Anh",
    "url": siteConfig.url,
    "description": siteConfig.description,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${siteConfig.url}/stock/{search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
        <link rel="manifest" href="/site.webmanifest" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${inter.className} ${inter.variable} min-h-screen scroll-auto antialiased selection:bg-indigo-100 selection:text-indigo-700 dark:bg-gray-950`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
        >
          <WatchlistProvider>
            <Navbar />
            <TickerTape />
            <ErrorBoundary>
              <main className="pt-[112px] md:pt-[140px] min-h-[calc(100vh-400px)]">{/* Adjusted padding for new TickerTape position */}
                {children}
              </main>
            </ErrorBoundary>
            <Footer />
          </WatchlistProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
