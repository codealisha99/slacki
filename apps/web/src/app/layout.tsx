import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://slacki-web.vercel.app"),
  title: {
    default: "Slacki — Slack actions with human approval",
    template: "%s · Slacki",
  },
  description:
    "Read Slack channel history and review messages and channel changes before they happen.",
  authors: [{ name: "Alisha Karma", url: "https://github.com/codealisha99" }],
  creator: "Alisha Karma",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Slacki",
    title: "Slacki — Slack actions with human approval",
    description:
      "Read Slack channel history and review messages and channel changes before they happen.",
  },
  twitter: {
    card: "summary",
    creator: "@karmalisha",
    title: "Slacki — Slack actions with human approval",
    description:
      "Read Slack channel history and review messages and channel changes before they happen.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
