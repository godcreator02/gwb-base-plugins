import * as React from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "logger:flex logger:w-fit logger:items-center logger:justify-between logger:gap-2 logger:rounded-md logger:border logger:border-input logger:bg-transparent logger:px-3 logger:py-2 logger:text-sm logger:whitespace-nowrap logger:shadow-xs logger:transition-[color,box-shadow] logger:outline-none logger:focus-visible:border-ring logger:focus-visible:ring-[3px] logger:focus-visible:ring-ring/50 logger:disabled:cursor-not-allowed logger:disabled:opacity-50 logger:aria-invalid:border-destructive logger:aria-invalid:ring-destructive/20 logger:data-[placeholder]:text-muted-foreground logger:data-[size=default]:h-9 logger:data-[size=sm]:h-8 logger:*:data-[slot=select-value]:line-clamp-1 logger:*:data-[slot=select-value]:flex logger:*:data-[slot=select-value]:items-center logger:*:data-[slot=select-value]:gap-2 logger:dark:bg-input/30 logger:dark:hover:bg-input/50 logger:dark:aria-invalid:ring-destructive/40 logger:[&_svg]:pointer-events-none logger:[&_svg]:shrink-0 logger:[&_svg:not([class*=size-])]:size-4 logger:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="logger:size-4 logger:opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  container,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  /** 浮层挂哪。不给就是 radix 缺省（body）；多桌面下该指 args.shell.portal，浮层才跟着本桌走 */
  container?: HTMLElement
}) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "logger:relative logger:z-50 logger:max-h-(--radix-select-content-available-height) logger:min-w-[8rem] logger:origin-(--radix-select-content-transform-origin) logger:overflow-x-hidden logger:overflow-y-auto logger:rounded-md logger:border logger:bg-popover logger:text-popover-foreground logger:shadow-md logger:data-[side=bottom]:slide-in-from-top-2 logger:data-[side=left]:slide-in-from-right-2 logger:data-[side=right]:slide-in-from-left-2 logger:data-[side=top]:slide-in-from-bottom-2 logger:data-[state=closed]:animate-out logger:data-[state=closed]:fade-out-0 logger:data-[state=closed]:zoom-out-95 logger:data-[state=open]:animate-in logger:data-[state=open]:fade-in-0 logger:data-[state=open]:zoom-in-95",
          position === "popper" &&
            "logger:data-[side=bottom]:translate-y-1 logger:data-[side=left]:-translate-x-1 logger:data-[side=right]:translate-x-1 logger:data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "logger:p-1",
            position === "popper" &&
              "logger:h-[var(--radix-select-trigger-height)] logger:w-full logger:min-w-[var(--radix-select-trigger-width)] logger:scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("logger:px-2 logger:py-1.5 logger:text-xs logger:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "logger:relative logger:flex logger:w-full logger:cursor-default logger:items-center logger:gap-2 logger:rounded-sm logger:py-1.5 logger:pr-8 logger:pl-2 logger:text-sm logger:outline-hidden logger:select-none logger:focus:bg-accent logger:focus:text-accent-foreground logger:data-[disabled]:pointer-events-none logger:data-[disabled]:opacity-50 logger:[&_svg]:pointer-events-none logger:[&_svg]:shrink-0 logger:[&_svg:not([class*=size-])]:size-4 logger:[&_svg:not([class*=text-])]:text-muted-foreground logger:*:[span]:last:flex logger:*:[span]:last:items-center logger:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="logger:absolute logger:right-2 logger:flex logger:size-3.5 logger:items-center logger:justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="logger:size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("logger:pointer-events-none logger:-mx-1 logger:my-1 logger:h-px logger:bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "logger:flex logger:cursor-default logger:items-center logger:justify-center logger:py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="logger:size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "logger:flex logger:cursor-default logger:items-center logger:justify-center logger:py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="logger:size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
