import type { Metadata } from 'next';
import './globals.css';

export const metadata:Metadata={title:'Outdoor Deal Watch',description:'Geprüfte Angebote für leichte, robuste Wanderhosen.'};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="de"><body>{children}</body></html>;
}
