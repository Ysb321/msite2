import React, { forwardRef } from "react";
import { Link as RouterLink } from "react-router-dom";

export interface NextLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  to?: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  children?: React.ReactNode;
}

const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(({ href, to, children, ...props }, ref) => {
  const target = href || to || "#";
  return (
    <RouterLink ref={ref} to={target} {...(props as any)}>
      {children}
    </RouterLink>
  );
});

Link.displayName = "Link";

export default Link;
