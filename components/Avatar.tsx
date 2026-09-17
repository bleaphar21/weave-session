"use client";

import { useState } from "react";

/** GitHub avatar with an initials fallback when the image cannot load. */
export function Avatar({
  src,
  login,
  size,
}: {
  src: string;
  login: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (failed || !src) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.round(size * 0.4) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-bar-track font-semibold uppercase text-accent"
      >
        {login.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
      className="shrink-0 rounded-full bg-page"
    />
  );
}
