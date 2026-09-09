import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "logger:inline-flex logger:w-fit logger:shrink-0 logger:items-center logger:justify-center logger:gap-1 logger:overflow-hidden logger:rounded-full logger:border logger:border-transparent logger:px-2 logger:py-0.5 logger:text-xs logger:font-medium logger:whitespace-nowrap logger:transition-[color,box-shadow] logger:focus-visible:border-ring logger:focus-visible:ring-[3px] logger:focus-visible:ring-ring/50 logger:aria-invalid:border-destructive logger:aria-invalid:ring-destructive/20 logger:dark:aria-invalid:ring-destructive/40 logger:[&>svg]:pointer-events-none logger:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "logger:bg-primary logger:text-primary-foreground logger:[a&]:hover:bg-primary/90",
        secondary:
          "logger:bg-secondary logger:text-secondary-foreground logger:[a&]:hover:bg-secondary/90",
        destructive:
          "logger:bg-destructive logger:text-white logger:focus-visible:ring-destructive/20 logger:dark:bg-destructive/60 logger:dark:focus-visible:ring-destructive/40 logger:[a&]:hover:bg-destructive/90",
        outline:
          "logger:border-border logger:text-foreground logger:[a&]:hover:bg-accent logger:[a&]:hover:text-accent-foreground",
        ghost: "logger:[a&]:hover:bg-accent logger:[a&]:hover:text-accent-foreground",
        link: "logger:text-primary logger:underline-offset-4 logger:[a&]:hover:underline",
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
