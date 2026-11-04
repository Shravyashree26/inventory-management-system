import { render, screen } from '@testing-library/react';
import App from './App';
import { getProducts } from './services/ApiService';

jest.mock('./services/ApiService', () => ({
  getProducts: jest.fn(),
  getProductById: jest.fn(),
  createProduct: jest.fn(),
  updateProductById: jest.fn(),
  deleteProductById: jest.fn(),
}));

test('renders the navbar and the product list from the API', async () => {
  getProducts.mockResolvedValue([
    { id: 1, title: 'Amazon Kindle', price: 450, quantity: 50 },
    { id: 2, title: 'Apple iPad', price: 950, quantity: 100 },
  ]);

  render(<App />);

  expect(screen.getByText(/Inventory Management System/i)).toBeInTheDocument();
  expect(await screen.findByText('Amazon Kindle')).toBeInTheDocument();
  expect(await screen.findByText('Apple iPad')).toBeInTheDocument();
});
