import * as React from "react"
import { cn } from "cn"

/** Same field treatment as Input (filled, accent ring on focus, dashed when disabled). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-field px-3 py-2 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-ring/40 focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:border-dashed disabled:bg-secondary disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
