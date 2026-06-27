/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-side document generation (docxtemplater/pizzip) and the postgres
  // driver are server-only; keep them out of the client bundle.
  serverExternalPackages: ["docxtemplater", "pizzip", "postgres"],
};

export default nextConfig;
