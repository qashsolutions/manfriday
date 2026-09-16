import styles from "@/app/(marketing)/blog/blog.module.css";

/**
 * Big-number tiles. MDX (next-mdx-remote) drops expression props, so items is a
 * string: "value|label;value|label|tone" with tone = accent | mint.
 */
export function Stats({ items }: { items: string }) {
  const rows = items.split(";").map((r) => r.split("|").map((x) => x.trim()));
  return (
    <div className={styles.stats}>
      {rows.map(([value, label, tone]) => (
        <div key={label} className={styles.stat}>
          <p className={styles.statValue} data-tone={tone}>{value}</p>
          <p className={styles.statLabel}>{label}</p>
        </div>
      ))}
    </div>
  );
}

export function Takeaways({ children }: { children: React.ReactNode }) {
  return <ul className="takeaways">{children}</ul>;
}
