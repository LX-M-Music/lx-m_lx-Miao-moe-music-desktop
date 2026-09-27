const path = require('path')
const ESLintPlugin = require('eslint-webpack-plugin')

module.exports = {
  target: process.env.BUILD_WIN7 ? 'electron22.3-renderer' : 'electron-renderer',
  entry: {
    'user-api-preload': path.join(__dirname, '../../src/main/modules/userApi/renderer/preload.js'),
    'source-plugin-preload': path.join(__dirname, '../../src/main/modules/sourcePlugins/preload.js'),
    'cookie-login-preload': path.join(__dirname, '../../src/main/modules/winMain/rendererEvent/cookieLoginPreload.ts'),
  },
  output: {
    filename: '[name].js',
    library: {
      type: 'commonjs2',
    },
    path: path.join(__dirname, '../../dist'),
    publicPath: '',
  },
  resolve: {
    alias: {
      '@root': path.join(__dirname, '../../src'),
      '@main': path.join(__dirname, '../../src/main'),
      '@renderer': path.join(__dirname, '../../src/renderer'),
      '@lyric': path.join(__dirname, '../../src/renderer-lyric'),
      '@static': path.join(__dirname, '../../src/static'),
      '@common': path.join(__dirname, '../../src/common'),
    },
    extensions: ['.tsx', '.ts', '.js', '.json', '.node'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            appendTsSuffixTo: [/\.vue$/],
          },
        },
      },
      {
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },
  plugins: [
    new ESLintPlugin({
      extensions: ['js'],
      formatter: require('eslint-formatter-friendly'),
    }),
  ],
}
