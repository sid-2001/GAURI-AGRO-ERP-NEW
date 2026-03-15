import './globals.css';

export const metadata = {
  title: 'Gauri Agro ERP',
  description: 'Billing, inventory, sales dashboard, and order history management app'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
