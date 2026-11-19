import { createContext, useContext, type ReactNode } from "react";

/** Whether the review screen's clicks count yet (`useInputArmed`). Outside an approval, always. */
export const InputArmedContext = createContext(true);

/**
 * A primary action's label, shown as a spinner while the screen's clicks
 * don't count yet. The label stays in place, transparent, so the button
 * keeps its width and its accessible name.
 */
export function ArmingLabel({ children }: { children: ReactNode }) {
  const armed = useContext(InputArmedContext);
  if (armed) return <>{children}</>;
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className="opacity-0">{children}</span>
      <span
        aria-hidden="true"
        className="absolute h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
      />
    </span>
  );
}
