import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "plugins:inline-flex plugins:shrink-0 plugins:items-center plugins:justify-center plugins:gap-2 plugins:rounded-md plugins:text-sm plugins:font-medium plugins:whitespace-nowrap plugins:transition-all plugins:outline-none plugins:focus-visible:border-ring plugins:focus-visible:ring-[3px] plugins:focus-visible:ring-ring/50 plugins:disabled:pointer-events-none plugins:disabled:opacity-50 plugins:aria-invalid:border-destructive plugins:aria-invalid:ring-destructive/20 plugins:dark:aria-invalid:ring-destructive/40 plugins:[&_svg]:pointer-events-none plugins:[&_svg]:shrink-0 plugins:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "plugins:bg-primary plugins:text-primary-foreground plugins:hover:bg-primary/90",
        destructive:
          "plugins:bg-destructive plugins:text-white plugins:hover:bg-destructive/90 plugins:focus-visible:ring-destructive/20 plugins:dark:bg-destructive/60 plugins:dark:focus-visible:ring-destructive/40",
        outline:
          "plugins:border plugins:bg-background plugins:shadow-xs plugins:hover:bg-accent plugins:hover:text-accent-foreground plugins:dark:border-input plugins:dark:bg-input/30 plugins:dark:hover:bg-input/50",
        secondary:
          "plugins:bg-secondary plugins:text-secondary-foreground plugins:hover:bg-secondary/80",
        ghost:
          "plugins:hover:bg-accent plugins:hover:text-accent-foreground plugins:dark:hover:bg-accent/50",
        link: "plugins:text-primary plugins:underline-offset-4 plugins:hover:underline",
      },
      size: {
        default: "plugins:h-9 plugins:px-4 plugins:py-2 plugins:has-[>svg]:px-3",
        xs: "plugins:h-6 plugins:gap-1 plugins:rounded-md plugins:px-2 plugins:text-xs plugins:has-[>svg]:px-1.5 plugins:[&_svg:not([class*=size-])]:size-3",
        sm: "plugins:h-8 plugins:gap-1.5 plugins:rounded-md plugins:px-3 plugins:has-[>svg]:px-2.5",
        lg: "plugins:h-10 plugins:rounded-md plugins:px-6 plugins:has-[>svg]:px-4",
        icon: "plugins:size-9",
        "icon-xs": "plugins:size-6 plugins:rounded-md plugins:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "plugins:size-8",
        "icon-lg": "plugins:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
