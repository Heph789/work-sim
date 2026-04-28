// Root layout — wraps every page. App Router convention: this file owns the
// <html> and <body> tags, the global stylesheet import, and the shared shell
// (top nav + max-width container). Per-page files render *inside* {children}.
//
// Kept as a server component (no 'use client' directive). It renders only
// static markup and the children prop, so there's no need to ship it as a
// client component.

import type { Metadata, ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

/** Document <head> defaults. Title is overridden per-page via Next's metadata API. */
export const metadata: Metadata = {
  title: 'work-sim',
  description: 'Two-agent paper-company work simulator',
};

/**
 * Root layout. Renders nav + container; the prototype has no auth, no
 * sidebar, and no footer, so this stays trivial.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <nav className="border-b bg-white">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold">work-sim</Link>
            {/* TODO: add per-route nav highlighting once we have more than one entry. */}
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
