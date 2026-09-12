"use client"

import * as React from "react"
import { cn } from "cn"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "plugins:fixed plugins:inset-0 plugins:z-50 plugins:bg-black/50 plugins:data-[state=closed]:animate-out plugins:data-[state=closed]:fade-out-0 plugins:data-[state=open]:animate-in plugins:data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
  /** 浮层挂哪。不给就是 radix 缺省（body）；多桌面下该指 args.shell.portal，浮层才跟着本桌走 */
  container?: HTMLElement
}) {
  return (
    <AlertDialogPortal container={container}>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "plugins:group/alert-dialog-content plugins:fixed plugins:top-[50%] plugins:left-[50%] plugins:z-50 plugins:grid plugins:w-full plugins:max-w-[calc(100%-2rem)] plugins:translate-x-[-50%] plugins:translate-y-[-50%] plugins:gap-4 plugins:rounded-lg plugins:border plugins:bg-background plugins:p-6 plugins:shadow-lg plugins:duration-200 plugins:data-[size=sm]:max-w-xs plugins:data-[state=closed]:animate-out plugins:data-[state=closed]:fade-out-0 plugins:data-[state=closed]:zoom-out-95 plugins:data-[state=open]:animate-in plugins:data-[state=open]:fade-in-0 plugins:data-[state=open]:zoom-in-95 plugins:data-[size=default]:sm:max-w-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "plugins:grid plugins:grid-rows-[auto_1fr] plugins:place-items-center plugins:gap-1.5 plugins:text-center plugins:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] plugins:has-data-[slot=alert-dialog-media]:gap-x-6 plugins:sm:group-data-[size=default]/alert-dialog-content:place-items-start plugins:sm:group-data-[size=default]/alert-dialog-content:text-left plugins:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "plugins:flex plugins:flex-col-reverse plugins:gap-2 plugins:group-data-[size=sm]/alert-dialog-content:grid plugins:group-data-[size=sm]/alert-dialog-content:grid-cols-2 plugins:sm:flex-row plugins:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "plugins:text-lg plugins:font-semibold plugins:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("plugins:text-sm plugins:text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "plugins:mb-2 plugins:inline-flex plugins:size-16 plugins:items-center plugins:justify-center plugins:rounded-md plugins:bg-muted plugins:sm:group-data-[size=default]/alert-dialog-content:row-span-2 plugins:*:[svg:not([class*=size-])]:size-8",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
