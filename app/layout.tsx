import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Knowball",
  description: "Two-player NBA roster draft game with a team wheel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-black text-white flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="fixed bottom-3 left-0 right-0 text-center text-xs text-gray-600">
          Created by:{" "}
          <a
            href="https://www.stevenchi.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-400 transition-colors"
          >
            Steven Chi
          </a>{" "}
          &amp; Chris Chi
        </footer>
      </body>
    </html>
  );
}
