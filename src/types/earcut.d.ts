declare module 'earcut' {
  /** Triangulate a flat polygon with optional hole-start vertex indices. */
  export default function earcut(
    vertices: number[],
    holes?: number[],
    dimensions?: number,
  ): number[];
}
