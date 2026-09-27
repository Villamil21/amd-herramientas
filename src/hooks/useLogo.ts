import { useEffect, useState } from "react";
import { getLogoDataUrl } from "../services/companyService";

export function useLogo(logoFile: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    void getLogoDataUrl(logoFile).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [logoFile]);
  return url;
}
