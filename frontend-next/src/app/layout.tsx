import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/Navbar";
import Footer from "@/components/ui/Footer";
import MainWrapper from "@/components/ui/MainWrapper";
import { ThemeProvider } from "next-themes";
import { TickerTape } from "@/components/TickerTape";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";
import { siteConfig } from "@/app/siteConfig";
import { WatchlistProvider } from "@/lib/watchlistContext"
import { LanguageProvider } from "@/lib/languageContext";

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
    default: "Phân Tích Cổ Phiếu Việt Nam | VNINDEX, VN30, Định Giá – Quang Anh",
    template: "%s | Quang Anh",
  },
  description: siteConfig.description,
  applicationName: siteConfig.shortName,
  keywords: siteConfig.keywords,
  category: "Finance",
  authors: [{ name: "Lê Quang Anh", url: siteConfig.url }],
  creator: "Lê Quang Anh",
  publisher: "Quang Anh Stocks",
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
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Phân Tích Cổ Phiếu Việt Nam | VNINDEX, VN30 – Quang Anh",
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.shortName,
    type: "website",
    locale: siteConfig.locale,
    alternateLocale: ["en_US"],
    images: [
      {
        url: siteConfig.defaultOgImage,
        width: 512,
        height: 512,
        alt: "Quang Anh – Nền tảng phân tích cổ phiếu Việt Nam",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Phân Tích Cổ Phiếu Việt Nam | VNINDEX, VN30 – Quang Anh",
    description: siteConfig.description,
    images: [siteConfig.defaultOgImage],
  },
  alternates: {
    canonical: "/",
    languages: {
      "x-default": "/",
      "vi": "/",
      "en": "/",
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "",
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
    "name": siteConfig.shortName,
    "alternateName": ["Quang Anh", "QuangAnh Stocks", "stock.quanganh.org"],
    "url": siteConfig.url,
    "description": siteConfig.description,
    "inLanguage": ["vi", "en"],
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${siteConfig.url}/stock/{search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Quang Anh",
    "legalName": "Lê Quang Anh",
    "url": siteConfig.url,
    "logo": {
      "@type": "ImageObject",
      "url": `${siteConfig.url}/android-chrome-512x512.png`,
      "width": 512,
      "height": 512,
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "contact@quanganh.org",
      "contactType": "customer support",
      "availableLanguage": ["Vietnamese", "English"],
    },
    "areaServed": "VN",
    "knowsAbout": ["Vietnam stock market", "Stock valuation", "DCF analysis", "HOSE", "HNX", "UPCOM"],
  };

  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body className={`${inter.className} ${inter.variable} min-h-screen scroll-auto antialiased selection:bg-indigo-100 selection:text-indigo-700 dark:bg-gray-950`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
        >
          <LanguageProvider>
            <WatchlistProvider>
              <Navbar />
              <TickerTape />
              <ClientErrorBoundary>
                <MainWrapper>{children}</MainWrapper>
              </ClientErrorBoundary>
              <Footer />
            </WatchlistProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
