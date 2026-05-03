const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      '@babel/plugin-proposal-export-namespace-from',
      require.resolve('react-native-worklets/plugin'),
    ],
  },
  { root, pkg }
);
