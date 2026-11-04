import axios from "axios";

// Empty by default -> same-origin "/api/..." (nginx in compose, ALB in AWS, CRA proxy in `npm start`).
// Set REACT_APP_API_BASE_URL only if the API really lives on another origin.
const baseURL = process.env.REACT_APP_API_BASE_URL || "";
const apiUrl = `${baseURL}/api/products`;

export const getProducts = async () => (await axios.get(apiUrl)).data;

export const createProduct = async (product) => (await axios.post(apiUrl, product)).data;

export const getProductById = async (id) => (await axios.get(`${apiUrl}/${id}`)).data;

export const updateProductById = async (id, product) => (await axios.put(`${apiUrl}/${id}`, product)).data;

export const deleteProductById = async (id) => (await axios.delete(`${apiUrl}/${id}`)).data;
