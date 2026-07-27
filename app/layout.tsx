import './globals.css';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'BrandVault',
  description: 'Trademark portfolio management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        </head>
        {/*
          No height or overflow here on purpose.
          `height: 100vh; overflow: hidden` used to live on the body. That is
          dashboard-shell styling: the dashboard is a fixed-viewport app with its
          own internal scroll regions, and it sets that constraint itself on its
          root element in app/page.tsx. On the body it applied to every route, so
          any ordinary document-flow page was clipped at the viewport with no way
          to scroll — which is what made /whats-new render only its first few
          entries. Pages that need a fixed viewport now claim it themselves.
        */}
        <body style={{ margin: 0, padding: 0, background: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
