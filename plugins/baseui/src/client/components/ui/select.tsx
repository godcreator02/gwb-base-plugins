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
        "baseui:flex baseui:w-fit baseui:items-center baseui:justify-between baseui:gap-2 baseui:rounded-md baseui:border baseui:border-input baseui:bg-transparent baseui:px-3 baseui:py-2 baseui:text-sm baseui:whitespace-nowrap baseui:shadow-xs baseui:transition-[color,box-shadow] baseui:outline-none baseui:focus-visible:border-ring baseui:focus-visible:ring-[3px] baseui:focus-visible:ring-ring/50 baseui:disabled:cursor-not-allowed baseui:disabled:opacity-50 baseui:aria-invalid:border-destructive baseui:aria-invalid:ring-destructive/20 baseui:data-[placeholder]:text-muted-foreground baseui:data-[size=default]:h-9 baseui:data-[size=sm]:h-8 baseui:*:data-[slot=select-value]:line-clamp-1 baseui:*:data-[slot=select-value]:flex baseui:*:data-[slot=select-value]:items-center baseui:*:data-[slot=select-value]:gap-2 baseui:dark:bg-input/30 baseui:dark:hover:bg-input/50 baseui:dark:aria-invalid:ring-destructive/40 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4 baseui:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="baseui:size-4 baseui:opacity-50" />
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
          "baseui:relative baseui:z-50 baseui:max-h-(--radix-select-content-available-height) baseui:min-w-[8rem] baseui:origin-(--radix-select-content-transform-origin) baseui:overflow-x-hidden baseui:overflow-y-auto baseui:rounded-md baseui:border baseui:bg-popover baseui:text-popover-foreground baseui:shadow-md baseui:data-[side=bottom]:slide-in-from-top-2 baseui:data-[side=left]:slide-in-from-right-2 baseui:data-[side=right]:slide-in-from-left-2 baseui:data-[side=top]:slide-in-from-bottom-2 baseui:data-[state=closed]:animate-out baseui:data-[state=closed]:fade-out-0 baseui:data-[state=closed]:zoom-out-95 baseui:data-[state=open]:animate-in baseui:data-[state=open]:fade-in-0 baseui:data-[state=open]:zoom-in-95",
          position === "popper" &&
            "baseui:data-[side=bottom]:translate-y-1 baseui:data-[side=left]:-translate-x-1 baseui:data-[side=right]:translate-x-1 baseui:data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "baseui:p-1",
            position === "popper" &&
              "baseui:h-[var(--radix-select-trigger-height)] baseui:w-full baseui:min-w-[var(--radix-select-trigger-width)] baseui:scroll-my-1"
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
      className={cn("baseui:px-2 baseui:py-1.5 baseui:text-xs baseui:text-muted-foreground", className)}
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
        "baseui:relative baseui:flex baseui:w-full baseui:cursor-default baseui:items-center baseui:gap-2 baseui:rounded-sm baseui:py-1.5 baseui:pr-8 baseui:pl-2 baseui:text-sm baseui:outline-hidden baseui:select-none baseui:focus:bg-accent baseui:focus:text-accent-foreground baseui:data-[disabled]:pointer-events-none baseui:data-[disabled]:opacity-50 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4 baseui:[&_svg:not([class*=text-])]:text-muted-foreground baseui:*:[span]:last:flex baseui:*:[span]:last:items-center baseui:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="baseui:absolute baseui:right-2 baseui:flex baseui:size-3.5 baseui:items-center baseui:justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="baseui:size-4" />
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
      className={cn("baseui:pointer-events-none baseui:-mx-1 baseui:my-1 baseui:h-px baseui:bg-border", className)}
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
        "baseui:flex baseui:cursor-default baseui:items-center baseui:justify-center baseui:py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="baseui:size-4" />
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
        "baseui:flex baseui:cursor-default baseui:items-center baseui:justify-center baseui:py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="baseui:size-4" />
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
