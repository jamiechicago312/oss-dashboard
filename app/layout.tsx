import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OSS Dashboard",
  description: "Evaluate open source GitHub organizations before contributing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
