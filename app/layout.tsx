import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://knowball.gg"),
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
        <footer className="text-center text-xs text-gray-600 py-8">
          Created by:{" "}
          <a
            href="https://www.stevenchi.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-400 transition-colors"
          >
            Steven Chi
          </a>{" "}
          &amp;{" "}
          <a
            href="https://www.chrischi.me"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-400 transition-colors"
          >
            Chris Chi
          </a>
        </footer>
      </body>
    </html>
  );
}
