import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolStatus } from "../../../../shared/agent";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { CodeBlock } from "./code-block";

// One line per call while collapsed, so a long run of tools stays readable.
export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("group/tool not-prose w-full", className)} {...props} />
);

export type ToolHeaderProps = {
  title: string;
  status: ToolStatus;
  className?: string;
};

// Running is static: the transcript's activity row carries the one spinner.
const statusIcons: Record<ToolStatus, ReactNode> = {
  running: <CircleDashedIcon className="size-3.5 shrink-0" />,
  completed: <CheckIcon className="size-3.5 shrink-0 text-green-600" />,
  failed: <XIcon className="size-3.5 shrink-0 text-red-600" />,
};

export const ToolHeader = ({ className, title, status, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-0.5 text-left text-muted-foreground text-sm hover:bg-muted/60 hover:text-foreground",
      className
    )}
    title={title}
    {...props}
  >
    {statusIcons[status]}
    <span className="min-w-0 truncate">{title}</span>
    <ChevronRightIcon className="ml-auto size-3.5 shrink-0 opacity-0 transition-transform group-hover/tool:opacity-100 group-data-[state=open]/tool:rotate-90 group-data-[state=open]/tool:opacity-100" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-1 mb-2 ml-1.5 space-y-2 border-l pl-4 text-popover-foreground outline-none",
      className
    )}
    {...props}
  />
);

/** Code inside a tool call: small, and scrolling rather than growing. */
export const toolCodeClassName =
  "text-xs [&>div]:max-h-64 [&_code]:text-xs [&_pre]:p-2 [&_pre]:text-xs";

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("overflow-hidden", className)} {...props}>
    <CodeBlock
      className={toolCodeClassName}
      code={JSON.stringify(input, null, 2)}
      language="json"
    />
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: string | undefined;
  isError?: boolean;
};

export const ToolOutput = ({
  className,
  output,
  isError,
  ...props
}: ToolOutputProps) => {
  if (!output) {
    return null;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md text-xs",
        isError
          ? "bg-destructive/10 text-destructive"
          : "bg-muted/50 text-foreground",
        className
      )}
      {...props}
    >
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 font-mono">{output}</pre>
    </div>
  );
};
