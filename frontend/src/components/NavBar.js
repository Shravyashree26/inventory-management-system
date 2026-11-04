import { NavLink } from "react-router-dom";

const linkClass = ({ isActive }) => `nav-link${isActive ? " active" : ""}`;

export default function NavBar() {
  return (
    <nav className="navbar navbar-expand-lg bg-body-tertiary mt-3">
      <div className="container-fluid">
        <NavLink className="navbar-brand" to="/">Inventory Management System</NavLink>

        <ul className="navbar-nav me-auto mb-2 mb-lg-0 flex-row gap-3">
          <li className="nav-item">
            <NavLink end className={linkClass} to="/">List</NavLink>
          </li>
          <li className="nav-item">
            <NavLink className={linkClass} to="/new">Add</NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}
