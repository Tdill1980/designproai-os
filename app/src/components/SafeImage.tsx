import { useState } from "react";

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: string;
}

export const SafeImage = ({ 
  src, 
  alt, 
  fallback = "/placeholder.svg", 
  className = "",
  loading = "lazy",
  decoding = "async",
  ...props 
}: SafeImageProps) => {
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const handleError = () => {
    console.error(`Failed to load image: ${src}`);
    setError(true);
    setIsLoading(false);
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  return (
    <>
      {isLoading && (
        <div className={`animate-pulse bg-muted ${className}`} />
      )}
      <img
        src={error ? fallback : src}
        alt={alt}
        className={`${className} ${isLoading ? 'hidden' : ''}`}
        onError={handleError}
        onLoad={handleLoad}
        loading={loading}
        decoding={decoding}
        {...props}
      />
    </>
  );
};
