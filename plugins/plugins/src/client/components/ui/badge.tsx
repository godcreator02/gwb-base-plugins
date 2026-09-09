import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "plugins:inline-flex plugins:w-fit plugins:shrink-0 plugins:items-center plugins:justify-center plugins:gap-1 plugins:overflow-hidden plugins:rounded-full plugins:border plugins:border-transparent plugins:px-2 plugins:py-0.5 plugins:text-xs plugins:font-medium plugins:whitespace-nowrap plugins:transition-[color,box-shadow] plugins:focus-visible:border-ring plugins:focus-visible:ring-[3px] plugins:focus-visible:ring-ring/50 plugins:aria-invalid:border-destructive plugins:aria-invalid:ring-destructive/20 plugins:dark:aria-invalid:ring-destructive/40 plugins:[&>svg]:pointer-events-none plugins:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "plugins:bg-primary plugins:text-primary-foreground plugins:[a&]:hover:bg-primary/90",
        secondary:
          "plugins:bg-secondary plugins:text-secondary-foreground plugins:[a&]:hover:bg-secondary/90",
        destructive:
          "plugins:bg-destructive plugins:text-white plugins:focus-visible:ring-destructive/20 plugins:dark:bg-destructive/60 plugins:dark:focus-visible:ring-destructive/40 plugins:[a&]:hover:bg-destructive/90",
        outline:
          "plugins:border-border plugins:text-foreground plugins:[a&]:hover:bg-accent plugins:[a&]:hover:text-accent-foreground",
        ghost: "plugins:[a&]:hover:bg-accent plugins:[a&]:hover:text-accent-foreground",
        link: "plugins:text-primary plugins:underline-offset-4 plugins:[a&]:hover:underline",
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
