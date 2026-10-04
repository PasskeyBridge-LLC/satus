/**
 * /blog/$slug—post detail.
 *
 * Wraps the parsed markdown HTML in the same Swiss-Red prose system used by
 * the rest of the site. Emits per-post head() (title, description, og,
 * twitter, canonical) and an Article JSON-LD block for AI-search ingestion.
 * Throws notFound() when the slug doesn't resolve so the root boundary
 * picks it up.
 */

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageShell } from "@/components/site/chrome";
import { type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

/* Single fixed TOC entry—markdown bodies are typically short enough that
 * splitting them into Sections is overkill, and parsing headings out of
 * pre-rendered HTML would add brittleness. The rail still anchors the page
 * visually and links back to the index. */
const SECTIONS: SectionMeta[] = [{ id: "post", n: "00", label: "Post" }];

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const { getPostBySlug } = await import("@/lib/blog");
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    return { post };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { post } = loaderData;
    const url = `${SITE_URL}/blog/${post.slug}`;
    const ogImage = post.ogImage
      ? post.ogImage.startsWith("http")
        ? post.ogImage
        : SITE_URL + post.ogImage
      : SITE_URL + "/og-image.png";

    /* Article schema improves citation behavior in AI search (Perplexity,
     * SearchGPT) and lets Google show date + author in the SERP. */
    const articleLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      author: { "@type": "Organization", name: post.author },
      publisher: {
        "@type": "Organization",
        name: "satus.sh",
        url: SITE_URL,
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      image: ogImage,
      keywords: post.tags.join(", ") || undefined,
    };

    /* BreadcrumbList helps Google render the path (Home › Blog › Post) in
     * the SERP and gives AI crawlers the route ancestry explicitly. */
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: SITE_URL + "/blog" },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    };

    return {
      meta: [
        { title: `${post.title}—satus.sh blog` },
        { name: "description", content: post.description },
        { name: "author", content: post.author },
        { property: "article:published_time", content: post.date },
        { property: "og:type", content: "article" },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.description },
        { property: "og:url", content: url },
        { property: "og:image", content: ogImage },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: post.title },
        { name: "twitter:description", content: post.description },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          /* TanStack head() accepts `children` for raw script bodies. */
          children: JSON.stringify(articleLd),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(breadcrumbLd),
        },
      ],
    };
  },
  component: BlogPostPage,
  notFoundComponent: () => (
    <PageShell sections={SECTIONS} currentPath="/blog">
      <div className="py-10 font-mono text-[13px] text-[var(--mute)]">
        post not found ·{" "}
        <Link to="/blog" className="text-[var(--signal)] underline">
          back to the log
        </Link>
      </div>
    </PageShell>
  ),
});

function BlogPostPage() {
  const { post } = Route.useLoaderData();

  return (
    <PageShell sections={SECTIONS} currentPath="/blog">
      <article id="post" className="scroll-mt-20">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mute)]">
          <span className="text-[var(--signal)]">§POST</span>
          <span className="mx-3 text-[var(--hairline)]">|</span>
          <Link to="/blog" className="hover:text-[var(--ink)]">
            ~/blog
          </Link>
          <span className="mx-3 text-[var(--hairline)]">|</span>
          <time dateTime={post.date}>{post.date}</time>
          <span className="mx-3 text-[var(--hairline)]">|</span>
          <span>{post.readingMinutes} min read</span>
        </div>

        <h1 className="mt-5 font-mono text-[28px] font-medium leading-[1.2] tracking-tight text-[var(--ink)] md:text-[36px]">
          {post.title}
        </h1>

        <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-[var(--ink)]/75">
          {post.description}
        </p>

        <hr className="mt-8" />

        {/* Markdown is authored in-house, so dangerouslySetInnerHTML is the
         * correct primitive here. Marked has no script-eval surface and the
         * source is committed to the repo (no user-submitted content). */}
        <div className="prose-satus mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />

        <hr className="mt-12" />

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 font-mono text-[12px] text-[var(--mute)]">
          <div>
            published {post.date} · {post.author}
            {post.tags.length > 0 && (
              <>
                {" · "}
                {post.tags.map((t: string, i: number) => (
                  <span key={t}>
                    {i > 0 && " "}·{t}
                  </span>
                ))}
              </>
            )}
          </div>
          <Link
            to="/blog"
            className="text-[var(--ink)] underline decoration-[var(--signal)] underline-offset-4 hover:text-[var(--signal)]"
          >
            ← all posts
          </Link>
        </footer>
      </article>
    </PageShell>
  );
}
