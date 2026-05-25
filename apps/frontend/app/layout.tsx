import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/providers/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'CloudTV — Plataforma de Streaming 24/7',
  description: 'Gestiona tu canal de TV en la nube',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body>
        <QueryProvider>
          {children}
          <Toaster
            position="bottom-right"
            theme="dark"
            toastOptions={{
              style: {
                background: '#1a2235',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e2e8f0',
              },
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
