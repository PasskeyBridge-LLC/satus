export declare const ROOT: string;
export declare const BLOG_DIR: string;
export type Frontmatter = Record<string, string>;
export interface PostFile {
  file: string;
  raw: string;
  frontmatter: Frontmatter | null;
  body: string;
}
export declare function splitPost(raw: string): { frontmatter: Frontmatter | null; body: string };
export declare function publishAtMs(frontmatter: Frontmatter | null | undefined): number | null;
export declare function isPublishable(frontmatter: Frontmatter | null, nowMs: number): boolean;
export declare function readPosts(dir?: string): PostFile[];
