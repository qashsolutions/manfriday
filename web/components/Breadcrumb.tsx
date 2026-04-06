"use client";

import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-400">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span key={`${item.href}-${index}`} className="flex items-center gap-1.5">
            {index > 0 && (
              <span className="text-gray-600 select-none" aria-hidden="true">
                &gt;
              </span>
            )}
            {isLast ? (
              <span className="text-gray-200 font-medium" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-accent hover:text-accent-hover hover:underline transition-colors"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
