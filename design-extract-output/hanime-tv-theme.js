// React Theme — extracted from https://hanime.tv/home
// Compatible with: Chakra UI, Stitches, Vanilla Extract, or any CSS-in-JS

/**
 * TypeScript type definition for this theme:
 *
 * interface Theme {
 *   colors: {
    primary: string;
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
    '24': string;
    '27': string;
    '32': string;
    '51.2': string;
    '26.88': string;
    '23.04': string;
    '19.2': string;
    '17.5': string;
    '16.8': string;
    '16.64': string;
 *   };
 *   space: {
    '1': string;
    '24': string;
    '48': string;
    '80': string;
    '96': string;
    '120': string;
    '165': string;
    '220': string;
    '384': string;
 *   };
 *   radii: {
    xs: string;
    full: string;
 *   };
 *   shadows: {
    sm: string;
    md: string;
    lg: string;
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
    "background": "#303030",
    "foreground": "#000000",
    "neutral50": "#ffffff",
    "neutral100": "#424242",
    "neutral200": "#000000",
    "neutral300": "#eeeeee",
    "neutral400": "#17181a",
    "neutral500": "#757575",
    "neutral600": "#303030",
    "neutral700": "#939496",
    "neutral800": "#bdbdbd",
    "neutral900": "#212121"
  },
  "fonts": {
    "body": "'Times New Roman', sans-serif"
  },
  "fontSizes": {
    "17": "17px",
    "18": "18px",
    "24": "24px",
    "27": "27px",
    "32": "32px",
    "51.2": "51.2px",
    "26.88": "26.88px",
    "23.04": "23.04px",
    "19.2": "19.2px",
    "17.5": "17.5px",
    "16.8": "16.8px",
    "16.64": "16.64px"
  },
  "space": {
    "1": "1px",
    "24": "24px",
    "48": "48px",
    "80": "80px",
    "96": "96px",
    "120": "120px",
    "165": "165px",
    "220": "220px",
    "384": "384px"
  },
  "radii": {
    "xs": "2px",
    "full": "50px"
  },
  "shadows": {
    "sm": "rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px",
    "md": "rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px",
    "lg": "rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px"
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
      "fontSize": "24px",
      "fontWeight": "400",
      "lineHeight": "24px"
    },
    "h3": {
      "fontSize": "23.04px",
      "fontWeight": "500",
      "lineHeight": "34.56px"
    }
  },
  "shape": {
    "borderRadius": 2
  },
  "shadows": [
    "rgba(0, 0, 0, 0.2) 0px 0px 0px 0px, rgba(0, 0, 0, 0.14) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px",
    "rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px",
    "rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px",
    "rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px",
    "rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px"
  ]
};

export default theme;
