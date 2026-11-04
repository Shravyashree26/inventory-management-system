import React, { useContext, useRef, useState } from "react";
import { createProduct } from "../services/ApiService";
import { useNavigate } from "react-router-dom";
import { ProductContext } from "../context/ProductContext";

export default function CreateProductForm() {

  const navigate = useNavigate();
  const titleRef = useRef();
  const priceRef = useRef();
  const quantityRef = useRef();
  const [error, setError] = useState(null);

  const { addProduct } = useContext(ProductContext);

  async function add(event) {
    event.preventDefault();
    setError(null);

    try {
      const response = await createProduct({
        title: titleRef.current.value.trim(),
        price: Number(priceRef.current.value),
        quantity: Number(quantityRef.current.value)
      });
      addProduct(response);
      navigate(`/${response.id}`);
    } catch (err) {
      console.error('Error creating product', err);
      setError("Could not save the product. Check the values and try again.");
    }
  }

  return (
    <form onSubmit={add}>
      <div className="mb-3 mt-5">
        <label htmlFor="title" className="form-label">Title</label>
        <input ref={titleRef} type="text" className="form-control" id="title" aria-describedby="titleHelp" required maxLength={255} />
        <div id="titleHelp" className="form-text">Input the product title here.</div>
      </div>
      <div className="mb-3">
        <div className="row">
          <div className="col-6">
            <label htmlFor="price" className="form-label">Price</label>
            <input ref={priceRef} type="number" min="0" step="0.01" className="form-control" id="price" required />
          </div>
          <div className="col-6">
            <label htmlFor="quantity" className="form-label">Quantity</label>
            <input ref={quantityRef} type="number" min="0" step="1" className="form-control" id="quantity" required />
          </div>
        </div>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <button type="submit" className="btn btn-primary">Add</button>
    </form>
  );
}
