import React, { createContext, useCallback, useMemo, useState } from 'react';

export const ProductContext = createContext();

export const ProductListProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState({});

  // Stable callbacks so components can list them in useEffect dependency arrays.
  const updateProducts = useCallback((list) => setProducts(list), []);
  const addProduct = useCallback((p) => setProducts((prev) => [...prev, p]), []);
  const updateProduct = useCallback((p) => setProduct(p), []);
  // ids come from the URL as strings but from the API as numbers -> compare as numbers
  const removeProductById = useCallback(
    (id) => setProducts((prev) => prev.filter((p) => p.id !== Number(id))),
    []
  );

  const value = useMemo(
    () => ({ products, product, updateProducts, updateProduct, removeProductById, addProduct }),
    [products, product, updateProducts, updateProduct, removeProductById, addProduct]
  );

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
};
