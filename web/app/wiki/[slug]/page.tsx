import ArticleView from "./ArticleView";
import { mockArticles } from "@/lib/mock-data";

export function generateStaticParams() {
  return mockArticles.map((a) => ({ slug: a.slug }));
}

export default function Page() {
  return <ArticleView />;
}
