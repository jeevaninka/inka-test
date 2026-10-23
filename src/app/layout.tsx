import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { AppProvider } from "@/components/providers/AppProvider";
import { MobileSidebarProvider } from "@/components/providers/MobileSidebarProvider";
import { getCachedServerSession } from "@/lib/auth.config";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "InkaTest - QA Intelligence Platform",
  description: "Test Case Management Tool",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCachedServerSession();

  return (
    <html
      lang="en"
      className="dark"
      data-theme="cyber-teal"
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen bg-background text-foreground`}>
        <AppProvider session={session}>
          <MobileSidebarProvider>
            {children}
          </MobileSidebarProvider>
        </AppProvider>
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            className: 'border border-border bg-popover text-popover-foreground shadow-2xl rounded-xl',
          }}
        />
      </body>
    </html>
  );
}
