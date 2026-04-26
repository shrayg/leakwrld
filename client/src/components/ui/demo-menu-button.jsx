import { useState } from 'react';
import { Button } from './button';

function Component() {
  const [open, setOpen] = useState(false);

  return (
    <Button
      className="group nav-hamburger-btn"
      variant="outline"
      size="icon"
      onClick={() => setOpen((prevState) => !prevState)}
      aria-expanded={open}
      aria-label={open ? 'Close menu' : 'Open menu'}
    >
      <svg
        className="pointer-events-none nav-hamburger-icon"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M4 12L20 12" className="nav-hamburger-path nav-hamburger-path--top" />
        <path d="M4 12H20" className="nav-hamburger-path nav-hamburger-path--mid" />
        <path d="M4 12H20" className="nav-hamburger-path nav-hamburger-path--bot" />
      </svg>
    </Button>
  );
}

export { Component };
