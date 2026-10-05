import { Header } from "@/components/marketing/Header";
import { Footer } from "@/components/marketing/Footer";

/** Sign-in and sign-up are marketing surfaces: most people who land here arrived
 *  cold, or by typing a URL. They get the same chrome as the rest of the site. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
