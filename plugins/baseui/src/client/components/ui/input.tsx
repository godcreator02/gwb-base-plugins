import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "baseui:h-9 baseui:w-full baseui:min-w-0 baseui:rounded-md baseui:border baseui:border-input baseui:bg-transparent baseui:px-3 baseui:py-1 baseui:text-base baseui:shadow-xs baseui:transition-[color,box-shadow] baseui:outline-none baseui:selection:bg-primary baseui:selection:text-primary-foreground baseui:file:inline-flex baseui:file:h-7 baseui:file:border-0 baseui:file:bg-transparent baseui:file:text-sm baseui:file:font-medium baseui:file:text-foreground baseui:placeholder:text-muted-foreground baseui:disabled:pointer-events-none baseui:disabled:cursor-not-allowed baseui:disabled:opacity-50 baseui:md:text-sm baseui:dark:bg-input/30",
        "baseui:focus-visible:border-ring baseui:focus-visible:ring-[3px] baseui:focus-visible:ring-ring/50",
        "baseui:aria-invalid:border-destructive baseui:aria-invalid:ring-destructive/20 baseui:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
