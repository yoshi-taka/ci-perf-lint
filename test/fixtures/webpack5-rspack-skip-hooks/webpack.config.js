const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.emit.tap('MyPlugin', (_compilation) => {
          console.log('Emitting assets...');
        });
      },
    },
  ],
  mode: 'production',
};
