export type DesignIqCombinedContact = {
  phone?: string;
  website?: string;
};

/**
 * The existing DesignIQ field intentionally accepts either a phone or website.
 * Preserve that UI while assigning the value to the correct transport key.
 */
export function classifyDesignIqCombinedContact(value?: string): DesignIqCombinedContact {
  const contact = value?.trim();
  if (!contact) return {};
  const isWebsite = /^(?:https?:\/\/|www\.)/i.test(contact)
    || /^[^\s@]+\.[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(contact);
  return isWebsite ? { website: contact } : { phone: contact };
}
