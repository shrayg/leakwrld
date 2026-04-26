/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        primary: {
            '50': 'hsl(NaN, NaN%, 97%)',
            '100': 'hsl(NaN, NaN%, 94%)',
            '200': 'hsl(NaN, NaN%, 86%)',
            '300': 'hsl(NaN, NaN%, 76%)',
            '400': 'hsl(NaN, NaN%, 64%)',
            '500': 'hsl(NaN, NaN%, 50%)',
            '600': 'hsl(NaN, NaN%, 40%)',
            '700': 'hsl(NaN, NaN%, 32%)',
            '800': 'hsl(NaN, NaN%, 24%)',
            '900': 'hsl(NaN, NaN%, 16%)',
            '950': 'hsl(NaN, NaN%, 10%)',
            DEFAULT: '#f3c669'
        },
        secondary: {
            '50': 'hsl(NaN, NaN%, 97%)',
            '100': 'hsl(NaN, NaN%, 94%)',
            '200': 'hsl(NaN, NaN%, 86%)',
            '300': 'hsl(NaN, NaN%, 76%)',
            '400': 'hsl(NaN, NaN%, 64%)',
            '500': 'hsl(NaN, NaN%, 50%)',
            '600': 'hsl(NaN, NaN%, 40%)',
            '700': 'hsl(NaN, NaN%, 32%)',
            '800': 'hsl(NaN, NaN%, 24%)',
            '900': 'hsl(NaN, NaN%, 16%)',
            '950': 'hsl(NaN, NaN%, 10%)',
            DEFAULT: '#e53935'
        },
        'neutral-50': '#ffffff',
        'neutral-100': '#000000',
        'neutral-200': '#424242',
        'neutral-300': '#9e9e9e',
        'neutral-400': '#eeeeee',
        'neutral-500': '#303030',
        'neutral-600': '#17181a',
        'neutral-700': '#616161',
        'neutral-800': '#757575',
        'neutral-900': '#bdbdbd',
        background: '#303030',
        foreground: '#000000'
    },
    fontFamily: {
        sans: [
            'Whitney',
            'sans-serif'
        ],
        body: [
            'Times New Roman',
            'sans-serif'
        ]
    },
    fontSize: {
        '15': [
            '15px',
            {
                lineHeight: '22.5px'
            }
        ],
        '16': [
            '16px',
            {
                lineHeight: '24px'
            }
        ],
        '17': [
            '17px',
            {
                lineHeight: '25.5px'
            }
        ],
        '18': [
            '18px',
            {
                lineHeight: '30px'
            }
        ],
        '20': [
            '20px',
            {
                lineHeight: '30px',
                letterSpacing: '0.4px'
            }
        ],
        '24': [
            '24px',
            {
                lineHeight: '24px'
            }
        ],
        '26': [
            '26px',
            {
                lineHeight: '26px'
            }
        ],
        '27': [
            '27px',
            {
                lineHeight: '40px'
            }
        ],
        '28': [
            '28px',
            {
                lineHeight: '28px'
            }
        ],
        '32': [
            '32px',
            {
                lineHeight: '48px'
            }
        ],
        '56': [
            '56px',
            {
                lineHeight: '56px'
            }
        ],
        '51.2': [
            '51.2px',
            {
                lineHeight: '57.6px'
            }
        ],
        '19.2': [
            '19.2px',
            {
                lineHeight: '25.6px'
            }
        ],
        '17.5': [
            '17.5px',
            {
                lineHeight: '26.25px'
            }
        ],
        '16.8': [
            '16.8px',
            {
                lineHeight: '25.2px'
            }
        ]
    },
    spacing: {
        '12': '24px',
        '15': '30px',
        '24': '48px',
        '28': '56px',
        '32': '64px',
        '40': '80px',
        '48': '96px',
        '60': '120px',
        '110': '220px',
        '192': '384px',
        '225': '450px',
        '1px': '1px',
        '165px': '165px',
        '329px': '329px'
    },
    borderRadius: {
        xs: '2px',
        md: '8px',
        full: '100px'
    },
    boxShadow: {
        sm: 'rgba(0, 0, 0, 0.2) 0px 2px 4px -1px, rgba(0, 0, 0, 0.14) 0px 4px 5px 0px, rgba(0, 0, 0, 0.12) 0px 1px 10px 0px',
        xs: 'rgba(0, 0, 0, 0.2) 0px 2px 1px -1px, rgba(0, 0, 0, 0.14) 0px 1px 1px 0px, rgba(0, 0, 0, 0.12) 0px 1px 3px 0px',
        md: 'rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px',
        lg: 'rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px',
        xl: 'rgba(23, 24, 26, 0.25) 0px 15px 20px 5px'
    },
    screens: {
        xs: '360px',
        '400px': '400px',
        sm: '651px',
        md: '820px',
        '951px': '951px',
        lg: '1069px',
        '1100px': '1100px',
        '1105px': '1105px',
        '1200px': '1200px',
        '1201px': '1201px',
        xl: '1327px',
        '1400px': '1400px',
        '1440px': '1440px',
        '2xl': '1500px',
        '1754px': '1754px',
        '1904px': '1904px'
    },
    transitionDuration: {
        '1': '0.001s',
        '100': '0.1s',
        '150': '0.15s',
        '200': '0.2s',
        '280': '0.28s',
        '300': '0.3s',
        '400': '0.4s',
        '500': '0.5s'
    },
    transitionTimingFunction: {
        default: 'ease',
        custom: 'cubic-bezier(0, 0, 0.2, 1)'
    },
    container: {
        center: true,
        padding: '0px'
    },
    maxWidth: {
        container: '100%'
    }
},
  },
};
