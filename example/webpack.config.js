const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

const root = path.resolve(__dirname, '..');
const rootModules = path.join(root, 'node_modules');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
  entry: './index.web.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    publicPath: isProduction ? './' : '/',
  },
  resolve: {
    alias: {
      'react-native$': 'react-native-web',
      'rn-video-timeline-ui': path.resolve(root, 'src'),
      react: path.join(__dirname, 'node_modules', 'react'),
      'react-dom': path.join(__dirname, 'node_modules', 'react-dom'),
      'react-native-web': path.join(__dirname, 'node_modules', 'react-native-web'),
      'react-native-reanimated': path.join(__dirname, 'node_modules', 'react-native-reanimated'),
      'react-native-gesture-handler': path.join(__dirname, 'node_modules', 'react-native-gesture-handler'),
      'react-native-worklets': path.join(__dirname, 'node_modules', 'react-native-worklets'),
    },
    extensions: ['.web.js', '.js', '.web.jsx', '.jsx', '.web.ts', '.ts', '.web.tsx', '.tsx'],
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        include: [
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, '..', 'src'),
          path.resolve(__dirname, 'index.web.js'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-env',
              '@babel/preset-typescript',
            ],
            plugins: [
              '@babel/plugin-proposal-export-namespace-from',
              'react-native-worklets/plugin',
            ],
            configFile: false,
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/,
        type: 'asset/resource',
      },
      {
        test: /\.(mp4|webm|ogg|mov|m4v)$/,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
    new webpack.EnvironmentPlugin({
      JEST_WORKER_ID: null,
    }),
    new webpack.DefinePlugin({
      process: { env: {} },
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    }),
  ],
  devServer: {
    static: path.join(__dirname, 'public'),
    compress: true,
    port: 8080,
    hot: true,
    historyApiFallback: true,
  },
  };
};
