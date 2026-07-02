import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASS, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_CLASS, "min-h-24", className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(FIELD_CLASS, "bg-[var(--background)]", className)}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-[var(--muted-foreground)]", className)}
      {...props}
    />
  );
}

/** A labeled form field: stacks a Label over its control. */
export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
