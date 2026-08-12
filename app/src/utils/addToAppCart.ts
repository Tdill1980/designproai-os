interface AppCartItem {
  id: string;
  title: string;
  priceId: string;
  priceDisplay: string;
}

export const addToAppCart = (item: AppCartItem) => {
  const event = new CustomEvent('add-to-app-cart', { detail: item });
  window.dispatchEvent(event);
};
