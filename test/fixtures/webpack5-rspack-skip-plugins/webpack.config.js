const path = require('path');
const MyCustomPlugin = require('./my-custom-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  plugins: [
    new MyCustomPlugin(),
  ],
  mode: 'production',
};
