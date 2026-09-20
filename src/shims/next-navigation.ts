import { useNavigate, useLocation, useParams as useRouterParams, useSearchParams as useRouterSearchParams } from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (url: string, _options?: { scroll?: boolean }) => navigate(url),
    replace: (url: string, _options?: { scroll?: boolean }) => navigate(url, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => {},
  };
}

export function usePathname(): string {
  const location = useLocation();
  return location.pathname;
}

export function useSearchParams(): URLSearchParams {
  const [searchParams] = useRouterSearchParams();
  return searchParams;
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  const params = useRouterParams();
  return params as unknown as T;
}
