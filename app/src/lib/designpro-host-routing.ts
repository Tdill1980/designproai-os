const MARKETING_HOSTS = new Set(["designproai.com", "www.designproai.com"]);

export const isDesignProMarketingHost = (hostname: string): boolean =>
  MARKETING_HOSTS.has(hostname.trim().toLowerCase().replace(/\.$/, ""));
