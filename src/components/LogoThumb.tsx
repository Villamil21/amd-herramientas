import { ImageOff } from "lucide-react";
import { useLogo } from "../hooks/useLogo";

export function LogoThumb({ logoFile, src, size = "md" }: { logoFile?: string | null; src?: string | null; size?: "md" | "lg" }) {
  const loaded = useLogo(src ? null : logoFile);
  const url = src ?? loaded;
  return (
    <div className={`logo-thumb ${size === "lg" ? "logo-thumb--lg" : ""}`}>
      {url ? <img src={url} alt="" /> : <ImageOff size={size === "lg" ? 20 : 14} />}
    </div>
  );
}
