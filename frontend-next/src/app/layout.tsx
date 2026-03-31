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
    default: "Vietnam Stock Market Today | Quang Anh",
    template: "%s | Quang Anh",
  },
  description: siteConfig.description,
  applicationName: siteConfig.shortName,
  keywords: siteConfig.keywords,
  category: "Finance",
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
    title: "Vietnam Stock Market Today | Quang Anh",
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.shortName,
    type: "website",
    locale: siteConfig.locale,
    images: [
      {
        url: siteConfig.defaultOgImage,
        width: 512,
        height: 512,
        alt: "Quang Anh Vietnam stock platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vietnam Stock Market Today | Quang Anh",
    description: siteConfig.description,
    creator: "@quanganh",
    images: [siteConfig.defaultOgImage],
  },
  alternates: {
    canonical: "/",
    languages: {
      "x-default": "/",
      en: "/",
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
    "alternateName": "Quang Anh",
    "url": siteConfig.url,
    "description": siteConfig.description,
    "inLanguage": "en",
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
    "url": siteConfig.url,
    "logo": `${siteConfig.url}/android-chrome-512x512.png`,
    "sameAs": [],
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
