/** CSS Modules interop for the client half. */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
