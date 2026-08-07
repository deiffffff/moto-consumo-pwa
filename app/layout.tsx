import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "Moto Consumo";
  const description = "Control sencillo y privado del consumo de combustible de tu motocicleta.";

  return {
    metadataBase: base,
    title,
    description,
    applicationName: title,
    manifest: "./manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title },
    formatDetection: { telephone: false },
    icons: { icon: "./icon-192.png", apple: "./apple-touch-icon.png" },
    openGraph: { title, description, type: "website", images: [{ url: new URL("/og.png", base), width: 1792, height: 1024 }] },
    twitter: { card: "summary_large_image", title, description, images: [new URL("/og.png", base)] },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0e" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
