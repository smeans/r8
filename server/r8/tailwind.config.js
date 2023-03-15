const colors = require('tailwindcss/colors')

module.exports = {
  purge: [],
  darkMode: false, // or 'media' or 'class'
  theme: {
    colors: {
      'dark-blue': '#3B4662'
    },
    extend: {
      colors: {
        teal: colors.teal,
        cyan: colors.cyan,
      },
        fontFamily: {
            sans: ["STIX Two Text", "serif"],
        }
    },
  },
  variants: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ]
}
