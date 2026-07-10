import { useState } from 'react';

type UserAvatarProps = {
  src?: string;
  initial: string;
  size: number;
  className?: string;
};

/** Profile photo with Google CDN referrer fix and initial fallback. */
export function UserAvatar({ src, initial, size, className }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!src && !failed;

  return (
    <span className={className} aria-hidden style={{ width: size, height: size }}>
      {showPhoto ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
