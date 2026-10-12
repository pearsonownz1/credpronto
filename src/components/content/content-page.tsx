import type { AnchorHTMLAttributes, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { buttonClasses } from "@/components/flow/ui";
import { jsonLdScript } from "@/lib/content/jsonld";
import { articleJsonLd, formatPostDate, guideCoverAlt, readingMinutes, type Post } from "@/lib/content/posts";
import { MarkdownBody } from "./markdown-body";

export function ContentShell({ children }: { children: ReactNode }) {
  return (
    <div>
      <MarketingHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6 md:py-16">{children}</main>
    </div>
  );
}

export function TranslateCta() {
  return (
    <aside className="mt-12 rounded-[var(--cp-radius)] border border-line bg-bg-muted px-5 py-6">
      <h2 className="text-xl font-bold tracking-tight">Get a certified translation</h2>
      <p className="mt-2 text-[15px] leading-normal text-ink-muted">
        Upload a PDF or phone photos. Preview the translation free, then pay only if it is
        right. Certified translations start at $9.95 per page.
      </p>
      <Link href="/translate" className={buttonClasses("primary", "mt-4 h-11 px-5 text-sm")}>
        Start your translation
      </Link>
    </aside>
  );
}

export function GuideCardGrid({
  kicker,
  title,
  lede,
  posts,
}: {
  kicker: string;
  title: string;
  lede: string;
  posts: Post[];
}) {
  return (
    <div>
      <MarketingHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6 md:py-16">
        <p className="preview-kicker blue">{kicker}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-normal text-ink-muted">{lede}</p>
        <ul className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {posts.map((post) => (
            <li key={post.canonical} className="min-w-0">
              <Link
                href={`/${post.section}/${post.slug}`}
                className="flex h-full flex-col overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white"
              >
                {post.cover ? (
                  <Image
                    src={post.cover}
                    alt={guideCoverAlt(post.headline)}
                    width={1200}
                    height={630}
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="aspect-[1200/630] h-auto w-full object-cover"
                  />
                ) : null}
                <div className="flex flex-1 flex-col px-4 py-4">
                  <h2 className="text-lg font-bold leading-snug tracking-tight">{post.headline}</h2>
                  <p className="mt-2 text-[15px] leading-normal text-ink-muted">{post.description}</p>
                  <p className="mt-auto pt-4 text-sm text-ink-muted">
                    {readingMinutes(post.body)} min read
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <TranslateCta />
      </main>
    </div>
  );
}

function GuideHero({ post }: { post: Post }) {
  if (!post.cover) return null;
  return (
    <Image
      src={post.cover}
      alt={guideCoverAlt(post.headline)}
      width={1200}
      height={630}
      preload
      sizes="(min-width: 768px) 720px, 100vw"
      className="mb-8 aspect-[1200/630] h-auto w-full rounded-[var(--cp-radius)] object-cover"
    />
  );
}

const mdxComponents = {
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} className="font-semibold text-primary underline" />
  ),
};

export function PostArticle({ post }: { post: Post }) {
  if (post.author) {
    const jsonLd = articleJsonLd(post);
    return (
      <ContentShell>
        <article>
          {jsonLd ? (
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
          ) : null}
          <GuideHero post={post} />
          <MarkdownBody source={post.body} />
        </article>
      </ContentShell>
    );
  }

  return (
    <ContentShell>
      <article>
        <GuideHero post={post} />
        <p className="preview-kicker blue">Guide</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{post.headline}</h1>
        <time dateTime={post.date} className="mt-3 block text-sm text-ink-muted">
          {formatPostDate(post.date)}
        </time>
        <div className="mt-8 space-y-4 text-[17px] leading-relaxed text-ink [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          <MDXRemote source={post.body} components={mdxComponents} />
        </div>
        <TranslateCta />
      </article>
    </ContentShell>
  );
}
