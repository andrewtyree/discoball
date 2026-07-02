import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a timestamp as `yyyy-mm-dd` (UTC) — the shape `<input type="date">`
 *  expects, and a deterministic display format for server-rendered dates. */
export function ymd(date: Date | string | null | undefined): string {
  if (date == null) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
