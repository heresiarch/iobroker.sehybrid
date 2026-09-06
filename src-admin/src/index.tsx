import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App';
import Tab from './Tab';
import packageInfo from '../package.json';

console.log(`iobroker.sehybrid@${packageInfo.version}`);

function build(): void {
    const container = document.getElementById('root');
    const root = createRoot(container!);

    // The admin tab (io-package `adminTab`) is opened with `?tab` in the query string;
    // the instance config dialog is opened without it. Render the matching component.
    const isTab = window.location.search.includes('tab') || window.location.hash.includes('tab');

    if (isTab) {
        root.render(<Tab adapterName="sehybrid" />);
    } else {
        root.render(<App adapterName="sehybrid" />);
    }
}

build();
