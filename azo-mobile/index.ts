import { registerRootComponent } from 'expo';

// Doit rester le premier import applicatif : voir theme/fontPatch.ts
import './theme/fontPatch';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
