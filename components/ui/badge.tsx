import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Badges are tinted, never saturated: a soft background with the matching
 * darker text tone (all pairs ≥ 5.2:1). `default` is the only solid one and is
 * reserved for counters.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "bg-secondary text-muted-foreground [a]:hover:bg-accent",
        destructive:
          "bg-destructive-soft text-destructive-text focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",
        success: "bg-success-soft text-success-text",
        warning: "bg-warning-soft text-warning-text",
        info: "bg-info-soft text-info-text",
        outline:
          "border-border bg-card text-muted-foreground [a]:hover:bg-accent [a]:hover:text-foreground",
        ghost:
          "hover:bg-accent hover:text-foreground",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
