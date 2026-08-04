import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { cookies, headers } from "next/headers";
import {
  ACCESS_SESSION_COOKIE,
  accessControlEnabled,
  validAccessSession,
} from "@/lib/access-control";
import { getSettings } from "@/lib/repository";
import { ConsoleFooter } from "./console-chrome";
import ViewerPresence from "./viewer-presence";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og-v2.png`;

  return {
    title: "CoralConsole",
    description: "A local-first topology and REST admin console for Coral Sequencer actors.",
    openGraph: {
      title: "CoralConsole",
      description: "Every actor. One clear picture.",
      images: [{ url: socialImage, width: 1731, height: 909, alt: "CoralConsole topology" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "CoralConsole",
      description: "Every actor. One clear picture.",
      images: [socialImage],
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const authenticated = !accessControlEnabled()
    || validAccessSession(cookieStore.get(ACCESS_SESSION_COOKIE)?.value);
  const themeStyle = {
    "--topology-color": authenticated ? getSettings().backgroundColor : "#ff8d84",
  } as CSSProperties;

  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${manrope.variable} ${plexMono.variable}`} style={themeStyle}>{authenticated ? <ViewerPresence /> : null}{children}{authenticated ? <ConsoleFooter /> : null}</body>
    </html>
  );
}
