import { AppRegistry } from 'react-native';
import App from './src/App';
import appConfig from './app.json';

const appName = appConfig.name;

AppRegistry.registerComponent(appName, () => App);

const rootTag = document.getElementById('root');
AppRegistry.runApplication(appName, {
  rootTag,
  initialProps: {},
});
