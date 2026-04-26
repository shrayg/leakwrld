// React Theme — extracted from https://hanime.tv/home
// Compatible with: Chakra UI, Stitches, Vanilla Extract, or any CSS-in-JS

/**
 * TypeScript type definition for this theme:
 *
 * interface Theme {
 *   colors: {
    primary: string;
    secondary: string;
    background: string;
    foreground: string;
    neutral50: string;
    neutral100: string;
    neutral200: string;
    neutral300: string;
    neutral400: string;
    neutral500: string;
    neutral600: string;
    neutral700: string;
    neutral800: string;
    neutral900: string;
 *   };
 *   fonts: {
    body: string;
 *   };
 *   fontSizes: {
    '17': string;
    '18': string;
    '20': string;
    '24': string;
    '26': string;
    '27': string;
    '28': string;
    '32': string;
    '56': string;
    '51.2': string;
    '19.2': string;
    '17.5': string;
 *   };
 *   space: {
    '1': string;
    '24': string;
    '30': string;
    '48': string;
    '56': string;
    '64': string;
    '80': string;
    '96': string;
    '120': string;
    '165': string;
    '220': string;
    '329': string;
    '384': string;
    '450': string;
 *   };
 *   radii: {
    xs: string;
    md: string;
    full: string;
 *   };
 *   shadows: {
    sm: string;
    xs: string;
    md: string;
    lg: string;
    xl: string;
 *   };
 *   states: {
 *     hover: { opacity: number };
 *     focus: { opacity: number };
 *     active: { opacity: number };
 *     disabled: { opacity: number };
 *   };
 * }
 */

export const theme = {
  "colors": {
    "primary": "#f3c669",
    "secondary": "#e53935",
    "background": "#303030",
    "foreground": "#000000",
    "neutral50": "#ffffff",
    "neutral100": "#000000",
    "neutral200": "#424242",
    "neutral300": "#9e9e9e",
    "neutral400": "#eeeeee",
    "neutral500": "#303030",
    "neutral600": "#17181a",
    "neutral700": "#616161",
    "neutral800": "#757575",
    "neutral900": "#bdbdbd"
  },
  "fonts": {
    "body": "'Times New Roman', sans-serif"
  },
  "fontSizes": {
    "17": "17px",
    "18": "18px",
    "20": "20px",
    "24": "24px",
    "26": "26px",
    "27": "27px",
    "28": "28px",
    "32": "32px",
    "56": "56px",
    "51.2": "51.2px",
    "19.2": "19.2px",
    "17.5": "17.5px"
  },
  "space": {
    "1": "1px",
    "24": "24px",
    "30": "30px",
    "48": "48px",
    "56": "56px",
    "64": "64px",
    "80": "80px",
    "96": "96px",
    "120": "120px",
    "165": "165px",
    "220": "220px",
    "329": "329px",
    "384": "384px",
    "450": "450px"
  },
  "radii": {
    "xs": "2px",
    "md": "8px",
    "full": "100px"
  },
  "shadows": {
    "sm": "rgba(0, 0, 0, 0.2) 0px 2px 4px -1px, rgba(0, 0, 0, 0.14) 0px 4px 5px 0px, rgba(0, 0, 0, 0.12) 0px 1px 10px 0px",
    "xs": "rgba(0, 0, 0, 0.2) 0px 2px 1px -1px, rgba(0, 0, 0, 0.14) 0px 1px 1px 0px, rgba(0, 0, 0, 0.12) 0px 1px 3px 0px",
    "md": "rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px",
    "lg": "rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px",
    "xl": "rgba(23, 24, 26, 0.25) 0px 15px 20px 5px"
  },
  "states": {
    "hover": {
      "opacity": 0.08
    },
    "focus": {
      "opacity": 0.12
    },
    "active": {
      "opacity": 0.16
    },
    "disabled": {
      "opacity": 0.38
    }
  }
};

// MUI v5 theme
export const muiTheme = {
  "palette": {
    "primary": {
      "main": "#f3c669",
      "light": "hsl(40, 85%, 83%)",
      "dark": "hsl(40, 85%, 53%)"
    },
    "secondary": {
      "main": "#e53935",
      "light": "hsl(1, 77%, 70%)",
      "dark": "hsl(1, 77%, 40%)"
    },
    "background": {
      "default": "#303030",
      "paper": "#424242"
    },
    "text": {
      "primary": "#000000",
      "secondary": "#ffffff"
    }
  },
  "typography": {
    "fontFamily": "'Times New Roman', sans-serif",
    "h1": {
      "fontSize": "32px",
      "fontWeight": "300",
      "lineHeight": "48px"
    },
    "h2": {
      "fontSize": "26px",
      "fontWeight": "400",
      "lineHeight": "26px"
    }
  },
  "shape": {
    "borderRadius": 8
  },
  "shadows": [
    "rgba(0, 0, 0, 0.2) 0px 0px 0px 0px, rgba(0, 0, 0, 0.14) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px",
    "rgba(0, 0, 0, 0.2) 0px 2px 1px -1px, rgba(0, 0, 0, 0.14) 0px 1px 1px 0px, rgba(0, 0, 0, 0.12) 0px 1px 3px 0px",
    "rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px",
    "rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px",
    "rgba(0, 0, 0, 0.2) 0px 2px 4px -1px, rgba(0, 0, 0, 0.14) 0px 4px 5px 0px, rgba(0, 0, 0, 0.12) 0px 1px 10px 0px"
  ]
};

export default theme;
