import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NBA Roster Wheel",
  description: "Two-player NBA roster draft game with a team wheel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-black text-white">
        {children}
      </body>
    </html>
  );
}
