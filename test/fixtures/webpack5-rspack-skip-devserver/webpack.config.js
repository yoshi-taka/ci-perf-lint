const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  devServer: {
    port: 3000,
    setupMiddlewares: (middlewares, devServer) => {
      devServer.app.get('/api/custom', (req, res) => {
        res.json({ message: 'custom api' });
      });
      return middlewares;
    },
  },
  mode: 'production',
};
