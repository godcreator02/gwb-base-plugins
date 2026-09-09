import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "plugins:h-9 plugins:w-full plugins:min-w-0 plugins:rounded-md plugins:border plugins:border-input plugins:bg-transparent plugins:px-3 plugins:py-1 plugins:text-base plugins:shadow-xs plugins:transition-[color,box-shadow] plugins:outline-none plugins:selection:bg-primary plugins:selection:text-primary-foreground plugins:file:inline-flex plugins:file:h-7 plugins:file:border-0 plugins:file:bg-transparent plugins:file:text-sm plugins:file:font-medium plugins:file:text-foreground plugins:placeholder:text-muted-foreground plugins:disabled:pointer-events-none plugins:disabled:cursor-not-allowed plugins:disabled:opacity-50 plugins:md:text-sm plugins:dark:bg-input/30",
        "plugins:focus-visible:border-ring plugins:focus-visible:ring-[3px] plugins:focus-visible:ring-ring/50",
        "plugins:aria-invalid:border-destructive plugins:aria-invalid:ring-destructive/20 plugins:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
