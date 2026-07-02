/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-side document generation (docxtemplater/pizzip) and the postgres
  // driver are server-only; keep them out of the client bundle.
  serverExternalPackages: ["docxtemplater", "pizzip", "postgres"],
  experimental: {
    serverActions: {
      // Template uploads (.docx up to 10 MB, MAX_TEMPLATE_BYTES) post through
      // a server action. The transport limit sits ABOVE the app limit so
      // multipart framing overhead never trips Next's opaque 413 first — the
      // friendly in-action size check is the one users see.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
