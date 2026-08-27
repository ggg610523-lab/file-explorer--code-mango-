// Builds only the renderer bundle (used by Tauri). The Electron main/preload
// configs aren't needed for the Tauri frontend.
// Dedicated renderer-only build for Tauri. Uses dev mode + transpile-only TS
// for fast iteration under `tauri:dev`. Under `tauri:build`
// (NODE_ENV=production) it switches to mode 'production' and minifies the JS —
// the dev build shipped 1.4MB of unminified JS to every launch, which was the
// main cause of slow perceived startup.
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const isProd = process.env.NODE_ENV === 'production';
// Only required for the production/minified build path.
const TerserPlugin = isProd ? require('terser-webpack-plugin') : null;

const config = {
  mode: isProd ? 'production' : 'development',
  devtool: isProd ? false : false,
  target: 'web',
  resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'] },
  entry: './src/renderer/index.tsx',
  // In production, let webpack cache persistent across runs for faster rebuilds,
  // but the first build is the one that matters for startup size.
  cache: isProd ? { type: 'filesystem' } : undefined,
  optimization: isProd
    ? {
        minimize: true,
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              compress: { drop_console: true, drop_debugger: true },
              format: { comments: false },
            },
          }),
        ],
      }
    : { minimize: false },
  module: {
    rules: [
      { test: /\.[jt]sx?$/, use: { loader: 'ts-loader', options: { transpileOnly: true } }, exclude: /node_modules/ },
      { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
      { test: /\.(woff|woff2|ttf|eot)$/, type: 'asset/resource', generator: { filename: 'fonts/[name][ext]' } },
    ],
  },
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: 'index.js',
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './src/renderer/index.html' }),
    new MiniCssExtractPlugin(),
  ],
};

const compiler = webpack(config);
compiler.run((err, stats) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(stats.toString({ colors: false, modules: false, chunks: false, assets: true }));
  process.exit(stats.hasErrors() ? 1 : 0);
});