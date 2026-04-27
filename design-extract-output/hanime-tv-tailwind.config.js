/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        primary: {
            '50': 'hsl(40, 85%, 97%)',
            '100': 'hsl(40, 85%, 94%)',
            '200': 'hsl(40, 85%, 86%)',
            '300': 'hsl(40, 85%, 76%)',
            '400': 'hsl(40, 85%, 64%)',
            '500': 'hsl(40, 85%, 50%)',
            '600': 'hsl(40, 85%, 40%)',
            '700': 'hsl(40, 85%, 32%)',
            '800': 'hsl(40, 85%, 24%)',
            '900': 'hsl(40, 85%, 16%)',
            '950': 'hsl(40, 85%, 10%)',
            DEFAULT: '#f3c669'
        },
        'neutral-50': '#ffffff',
        'neutral-100': '#424242',
        'neutral-200': '#000000',
        'neutral-300': '#eeeeee',
        'neutral-400': '#17181a',
        'neutral-500': '#757575',
        'neutral-600': '#303030',
        'neutral-700': '#939496',
        'neutral-800': '#bdbdbd',
        'neutral-900': '#212121',
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
        '14': [
            '14px',
            {
                lineHeight: 'normal'
            }
        ],
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
        '24': [
            '24px',
            {
                lineHeight: '24px'
            }
        ],
        '27': [
            '27px',
            {
                lineHeight: '40px'
            }
        ],
        '32': [
            '32px',
            {
                lineHeight: '48px'
            }
        ],
        '51.2': [
            '51.2px',
            {
                lineHeight: '57.6px'
            }
        ],
        '26.88': [
            '26.88px',
            {
                lineHeight: '40.32px'
            }
        ],
        '23.04': [
            '23.04px',
            {
                lineHeight: '34.56px'
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
        ],
        '16.64': [
            '16.64px',
            {
                lineHeight: '24.96px'
            }
        ]
    },
    spacing: {
        '12': '24px',
        '24': '48px',
        '40': '80px',
        '48': '96px',
        '60': '120px',
        '110': '220px',
        '192': '384px',
        '1px': '1px',
        '165px': '165px'
    },
    borderRadius: {
        xs: '2px',
        full: '50px'
    },
    boxShadow: {
        sm: 'rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px',
        md: 'rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px',
        lg: 'rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px'
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
        '200': '0.2s',
        '300': '0.3s',
        '400': '0.4s'
    },
    transitionTimingFunction: {
        default: 'ease',
        custom: 'cubic-bezier(0.5, 0, 0.1, 1)'
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
