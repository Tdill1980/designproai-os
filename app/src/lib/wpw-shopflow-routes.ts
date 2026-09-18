/** Native WPW tools share the ShopFlow account shell, never the DesignPro shell. */
export function isWpwShopflowToolRoute(pathname: string) {
  return ["/wallwrap-design", "/pattern-wrap", "/wall-wrap/how-it-works", "/wall-wrap/faq"].includes(pathname);
}
