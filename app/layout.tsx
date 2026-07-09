import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Wellness Assessment",
  description: "A health assessment funnel with resumable persistence and subscription-gated results."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
