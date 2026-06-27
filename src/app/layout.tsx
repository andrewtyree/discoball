import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DiscoBall — records, documents & deadlines",
  description:
    "A configurable, multi-user records and document-workflow manager.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
