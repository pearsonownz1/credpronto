import type { AnchorHTMLAttributes, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import { MarketingHeader } from "@/components/flow/flow-header";
import { buttonClasses } from "@/components/flow/ui";
import { formatPostDate, type Post } from "@/lib/content/posts";

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

export function PostList({
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
    <ContentShell>
      <p className="preview-kicker blue">{kicker}</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-4 text-[17px] leading-normal text-ink-muted">{lede}</p>
      <ul className="mt-10 grid gap-8">
        {posts.map((post) => (
          <li key={post.canonical} className="border-t border-line pt-6">
            <time dateTime={post.date} className="text-sm text-ink-muted">
              {formatPostDate(post.date)}
            </time>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">
              <Link href={`/${post.section}/${post.slug}`} className="hover:text-primary">
                {post.title}
              </Link>
            </h2>
            <p className="mt-2 text-[15px] leading-normal text-ink-muted">{post.description}</p>
          </li>
        ))}
      </ul>
      <TranslateCta />
    </ContentShell>
  );
}

const mdxComponents = {
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} className="font-semibold text-primary underline" />
  ),
};

export function PostArticle({ post }: { post: Post }) {
  return (
    <ContentShell>
      <article>
        <p className="preview-kicker blue">{post.section === "blog" ? "Blog" : "Guide"}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{post.title}</h1>
        <time dateTime={post.date} className="mt-3 block text-sm text-ink-muted">
          {formatPostDate(post.date)}
        </time>
        <Image
          src={post.cover}
          alt=""
          width={1200}
          height={630}
          className="mt-6 aspect-[1200/630] h-auto w-full rounded-[var(--cp-radius)] object-cover"
        />
        <div className="mt-8 space-y-4 text-[17px] leading-relaxed text-ink [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          <MDXRemote source={post.body} components={mdxComponents} />
        </div>
        <TranslateCta />
      </article>
    </ContentShell>
  );
}
