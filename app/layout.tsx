import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Port Capacity Platform — AUK Marine & Mining",
  description: "Port cargo projection and capacity optimization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body
        className="min-h-full flex flex-col bg-slate-950"
        style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
