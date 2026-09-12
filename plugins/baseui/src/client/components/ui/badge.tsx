import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "baseui:inline-flex baseui:w-fit baseui:shrink-0 baseui:items-center baseui:justify-center baseui:gap-1 baseui:overflow-hidden baseui:rounded-full baseui:border baseui:border-transparent baseui:px-2 baseui:py-0.5 baseui:text-xs baseui:font-medium baseui:whitespace-nowrap baseui:transition-[color,box-shadow] baseui:focus-visible:border-ring baseui:focus-visible:ring-[3px] baseui:focus-visible:ring-ring/50 baseui:aria-invalid:border-destructive baseui:aria-invalid:ring-destructive/20 baseui:dark:aria-invalid:ring-destructive/40 baseui:[&>svg]:pointer-events-none baseui:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "baseui:bg-primary baseui:text-primary-foreground baseui:[a&]:hover:bg-primary/90",
        secondary:
          "baseui:bg-secondary baseui:text-secondary-foreground baseui:[a&]:hover:bg-secondary/90",
        destructive:
          "baseui:bg-destructive baseui:text-white baseui:focus-visible:ring-destructive/20 baseui:dark:bg-destructive/60 baseui:dark:focus-visible:ring-destructive/40 baseui:[a&]:hover:bg-destructive/90",
        outline:
          "baseui:border-border baseui:text-foreground baseui:[a&]:hover:bg-accent baseui:[a&]:hover:text-accent-foreground",
        ghost: "baseui:[a&]:hover:bg-accent baseui:[a&]:hover:text-accent-foreground",
        link: "baseui:text-primary baseui:underline-offset-4 baseui:[a&]:hover:underline",
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
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
