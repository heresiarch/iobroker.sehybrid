import React from 'react';
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles';

import { GenericApp, Loader, type GenericAppProps, type GenericAppSettings } from '@iobroker/adapter-react-v5';

import Settings from './components/Settings';

import en from './i18n/en.json';
import de from './i18n/de.json';
import ru from './i18n/ru.json';
import pt from './i18n/pt.json';
import nl from './i18n/nl.json';
import fr from './i18n/fr.json';
import it from './i18n/it.json';
import es from './i18n/es.json';
import pl from './i18n/pl.json';
import uk from './i18n/uk.json';
import zhCn from './i18n/zh-cn.json';

/**
 * Instance configuration dialog for the sehybrid adapter.
 */
class App extends GenericApp {
    constructor(props: GenericAppProps) {
        const extendedProps: GenericAppSettings = {
            ...props,
            encryptedFields: [],
            translations: {
                en,
                de,
                ru,
                pt,
                nl,
                fr,
                it,
                es,
                pl,
                uk,
                'zh-cn': zhCn,
            },
        };

        // during development the UI runs on port 3000, but the admin socket is on 8081
        extendedProps.socket = { port: parseInt(window.location.port, 10) || 8081 };
        if (extendedProps.socket.port === 3000) {
            extendedProps.socket.port = 8081;
        }

        super(props, extendedProps);
    }

    onConnectionReady(): void {
        // executed when the socket connection is ready
    }

    render(): React.JSX.Element {
        if (!this.state.loaded) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <Loader themeType={this.state.themeType} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <div
                        className="App"
                        style={{
                            background: this.state.theme.palette.background.default,
                            color: this.state.theme.palette.text.primary,
                        }}
                    >
                        <Settings
                            native={this.state.native}
                            onChange={(attr: string, value: unknown) => this.updateNativeValue(attr, value)}
                            socket={this.socket}
                            adapterName={this.adapterName}
                            instance={this.instance}
                            theme={this.state.theme}
                        />
                        {this.renderError()}
                        {this.renderToast()}
                        {this.renderSaveCloseButtons()}
                    </div>
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}

export default App;
