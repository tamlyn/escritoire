import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

// Adapted from AI Elements without its approval state machine: in our model a
// pending request is simply shown until it is answered.

export type ConfirmationProps = ComponentProps<typeof Alert>;

export const Confirmation = ({ className, ...props }: ConfirmationProps) => (
  <Alert className={cn("flex flex-col gap-2", className)} {...props} />
);

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <AlertDescription className={cn("inline", className)} {...props} />
);

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => (
  <div
    className={cn("flex items-center justify-end gap-2 self-end", className)}
    {...props}
  />
);

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button className="h-8 px-3 text-sm" type="button" {...props} />
);
