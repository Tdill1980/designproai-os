import React, { createContext, useContext, useState, useEffect } from 'react';

interface AppCartItem {
  id: string;
  title: string;
  priceId: string;
  priceDisplay: string;
}

interface AppCartContextType {
  items: AppCartItem[];
  addItem: (item: AppCartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  totalItems: number;
}

const AppCartContext = createContext<AppCartContextType | undefined>(undefined);

const STORAGE_KEY = 'restylepro_app_cart';

export const AppCartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<AppCartItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (item: AppCartItem) => {
    setItems(prev => {
      const exists = prev.find(i => i.id === item.id);
      if (exists) return prev;
      return [...prev, item];
    });
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalItems = items.length;

  return (
    <AppCartContext.Provider value={{ items, addItem, removeItem, clearCart, totalItems }}>
      {children}
    </AppCartContext.Provider>
  );
};

export const useAppCart = () => {
  const context = useContext(AppCartContext);
  if (!context) {
    throw new Error('useAppCart must be used within AppCartProvider');
  }
  return context;
};
