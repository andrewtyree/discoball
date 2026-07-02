"use client";
/** Route-level error boundary for the records screens. */
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export default function RecordsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card role="alert" className="mx-auto mt-16 max-w-md py-10 text-center">
      <CardTitle className="text-base">Something went wrong</CardTitle>
      <CardDescription className="mx-auto mb-4 max-w-sm">
        The records screen hit an unexpected error
        {error.digest ? ` (ref ${error.digest})` : ""}. Your data is safe — try
        again, and if it keeps happening check the server logs.
      </CardDescription>
      <Button type="button" variant="outline" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
