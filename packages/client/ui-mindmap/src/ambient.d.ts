/**
 * Ambient declarations for side-effect asset imports used by the mind-map client bundle.
 * @module ui-mindmap/ambient
 */

declare module '*.css' {
  const content: string
  export default content
}