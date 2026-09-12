"use client"

import * as React from "react"
import { cn } from "cn"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** 浮层挂哪。不给就是 radix 缺省（body）；多桌面下该指 args.shell.portal，浮层才跟着本桌走 */
  container?: HTMLElement
}) {
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "baseui:z-50 baseui:max-h-(--radix-dropdown-menu-content-available-height) baseui:min-w-[8rem] baseui:origin-(--radix-dropdown-menu-content-transform-origin) baseui:overflow-x-hidden baseui:overflow-y-auto baseui:rounded-md baseui:border baseui:bg-popover baseui:p-1 baseui:text-popover-foreground baseui:shadow-md baseui:data-[side=bottom]:slide-in-from-top-2 baseui:data-[side=left]:slide-in-from-right-2 baseui:data-[side=right]:slide-in-from-left-2 baseui:data-[side=top]:slide-in-from-bottom-2 baseui:data-[state=closed]:animate-out baseui:data-[state=closed]:fade-out-0 baseui:data-[state=closed]:zoom-out-95 baseui:data-[state=open]:animate-in baseui:data-[state=open]:fade-in-0 baseui:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "baseui:relative baseui:flex baseui:cursor-default baseui:items-center baseui:gap-2 baseui:rounded-sm baseui:px-2 baseui:py-1.5 baseui:text-sm baseui:outline-hidden baseui:select-none baseui:focus:bg-accent baseui:focus:text-accent-foreground baseui:data-[disabled]:pointer-events-none baseui:data-[disabled]:opacity-50 baseui:data-[inset]:pl-8 baseui:data-[variant=destructive]:text-destructive baseui:data-[variant=destructive]:focus:bg-destructive/10 baseui:data-[variant=destructive]:focus:text-destructive baseui:dark:data-[variant=destructive]:focus:bg-destructive/20 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4 baseui:[&_svg:not([class*=text-])]:text-muted-foreground baseui:data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "baseui:relative baseui:flex baseui:cursor-default baseui:items-center baseui:gap-2 baseui:rounded-sm baseui:py-1.5 baseui:pr-2 baseui:pl-8 baseui:text-sm baseui:outline-hidden baseui:select-none baseui:focus:bg-accent baseui:focus:text-accent-foreground baseui:data-[disabled]:pointer-events-none baseui:data-[disabled]:opacity-50 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="baseui:pointer-events-none baseui:absolute baseui:left-2 baseui:flex baseui:size-3.5 baseui:items-center baseui:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="baseui:size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "baseui:relative baseui:flex baseui:cursor-default baseui:items-center baseui:gap-2 baseui:rounded-sm baseui:py-1.5 baseui:pr-2 baseui:pl-8 baseui:text-sm baseui:outline-hidden baseui:select-none baseui:focus:bg-accent baseui:focus:text-accent-foreground baseui:data-[disabled]:pointer-events-none baseui:data-[disabled]:opacity-50 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <span className="baseui:pointer-events-none baseui:absolute baseui:left-2 baseui:flex baseui:size-3.5 baseui:items-center baseui:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="baseui:size-2 baseui:fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "baseui:px-2 baseui:py-1.5 baseui:text-sm baseui:font-medium baseui:data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("baseui:-mx-1 baseui:my-1 baseui:h-px baseui:bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "baseui:ml-auto baseui:text-xs baseui:tracking-widest baseui:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "baseui:flex baseui:cursor-default baseui:items-center baseui:gap-2 baseui:rounded-sm baseui:px-2 baseui:py-1.5 baseui:text-sm baseui:outline-hidden baseui:select-none baseui:focus:bg-accent baseui:focus:text-accent-foreground baseui:data-[inset]:pl-8 baseui:data-[state=open]:bg-accent baseui:data-[state=open]:text-accent-foreground baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4 baseui:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="baseui:ml-auto baseui:size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "baseui:z-50 baseui:min-w-[8rem] baseui:origin-(--radix-dropdown-menu-content-transform-origin) baseui:overflow-hidden baseui:rounded-md baseui:border baseui:bg-popover baseui:p-1 baseui:text-popover-foreground baseui:shadow-lg baseui:data-[side=bottom]:slide-in-from-top-2 baseui:data-[side=left]:slide-in-from-right-2 baseui:data-[side=right]:slide-in-from-left-2 baseui:data-[side=top]:slide-in-from-bottom-2 baseui:data-[state=closed]:animate-out baseui:data-[state=closed]:fade-out-0 baseui:data-[state=closed]:zoom-out-95 baseui:data-[state=open]:animate-in baseui:data-[state=open]:fade-in-0 baseui:data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
