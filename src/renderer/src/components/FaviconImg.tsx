import { useEffect, useState } from 'react'

interface Props {
  src: string | null
  className: string
  fallbackClassName: string
  fallbackColor?: string
}

export default function FaviconImg({ src, className, fallbackClassName, fallbackColor }: Props): JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return <img className={className} src={src} alt="" onError={() => setFailed(true)} />
  }
  return <span className={fallbackClassName} style={fallbackColor ? { background: fallbackColor } : undefined} />
}
