import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Consumer Sentiment Analyzer',
  description: 'Upload customer feedback PDFs and get a structured sentiment analysis.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="header">
            <h1>Consumer Sentiment Analyzer</h1>
            <p className="subtitle">Upload a PDF of feedback responses. Get a structured analysis.</p>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
