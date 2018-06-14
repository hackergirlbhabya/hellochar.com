const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require("path");

module.exports = {
  entry: {
    main: "./src/index.tsx",
    kiosk: "./openpose_kiosk/src/index.tsx",
    // wip: "./src/wip/index.ts",
  },
  output: {
    publicPath: "/",
    path: path.resolve(__dirname, "public"),
    filename: "[name].js",
    chunkFilename: '[name].bundle.js',
  },
  optimization: {
    splitChunks: {
      chunks: "all"
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/
      },
      // don't handle scss here; do it in prod/dev since they're done differently
      // {
      //   test: /\.scss$/,
      //   use: [
      //     // MiniCssExtractPlugin.loader,
      //     "style-loader",
      //     'css-loader',
      //     'sass-loader'
      //   ]
      // },
      {
        test: /\.(vert|frag)$/,
        use: "webpack-glsl-loader"
      }
    ]
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    alias: {
      'three-examples': path.resolve(__dirname, 'node_modules/three/examples/js/')
    }
  },
  plugins: [
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: 'src/index.template.html',
      // brittle - manually find which chunks don't belong here and exclude them.
      // see https://github.com/jantimon/html-webpack-plugin/issues/218
      // they're trying to make it default in the next major rev
      excludeChunks: ['kiosk', 'vendors~kiosk']
    }),
    new HtmlWebpackPlugin({
      filename: 'kiosk.html',
      template: 'src/index.template.html',
      excludeChunks: ['main', 'vendors~main']
    }),
  ]
};
