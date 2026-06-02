import { useState, type CSSProperties } from 'react';

type Props = {
  src?: string;
  alt?: string;
  height: number;
  className?: string;
  style?: CSSProperties;
};

/** Course hero/card photo with a calm placeholder when the URL is missing or fails to load. */
export function CoursePhoto({ src, alt = '', height, className, style }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  if (!showImage) {
    return (
      <div
        className={className}
        aria-hidden={alt ? undefined : true}
        style={{
          width: '100%',
          height,
          background: 'linear-gradient(135deg, rgba(233,245,234,0.95) 0%, rgba(200,230,205,0.75) 55%, rgba(180,210,185,0.65) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(45,122,58,0.35)',
          fontSize: height > 160 ? 42 : 28,
          ...style,
        }}
      >
        ⛳
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ width: '100%', height, objectFit: 'cover', display: 'block', ...style }}
    />
  );
}
