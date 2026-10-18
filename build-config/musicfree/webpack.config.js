const path = require('node:path')

module.exports = {
  mode: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  target: 'web',
  devtool: false,
  entry: path.resolve(__dirname, '../../src/main/modules/musicFree/renderer.js'),
  output: { path: path.resolve(__dirname, '../../dist'), filename: 'musicfree-runtime.js', iife: true },
  resolve: {
    alias: { '@common': path.resolve(__dirname, '../../src/common') },
    extensions: ['.ts', '.js', '.json'],
    fallback: { buffer: require.resolve('buffer/'), crypto: false, stream: false },
  },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
  optimization: { minimize: false },
  performance: { hints: false },
}
