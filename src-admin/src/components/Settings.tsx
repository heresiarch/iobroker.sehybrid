import React from 'react';

import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Paper from '@mui/material/Paper';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { I18n, type AdminConnection, type IobTheme } from '@iobroker/adapter-react-v5';

// Shared, pure config validation reused by the adapter and this admin form.
// We import the SAME validateConfig / sunspec helpers from the adapter's src/lib
// rather than duplicate them. src-admin/tsconfig.json + Vite resolve the TS sources
// directly (Vite transpiles them on the fly), so no build step is needed for them.
import { validateConfig } from '../../../src/lib/config-validation';
import {
    getRegisterAddress,
    getInverterValueDefs,
    getMeterValueDefs,
    getBatteryValueDefs,
    getBatteryBase,
    getDeviceRegisterAddress,
} from '../../../src/lib/sunspec-map';
import type { SunSpecRegisterDef } from '../../../src/lib/sunspec-map';

const styles: Record<string, React.CSSProperties> = {
    input: {
        marginTop: 0,
        marginRight: 20,
        minWidth: 200,
    },
    controlElement: {
        marginBottom: 5,
    },
    button: {
        marginTop: 16,
    },
    status: {
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
    },
    statusText: {
        marginLeft: 10,
    },
    success: {
        color: '#2e7d32',
    },
    failure: {
        color: '#c62828',
    },
    tableWrapper: {
        marginTop: 24,
        maxWidth: '100%',
    },
    scrollBox: {
        maxHeight: 360,
        overflow: 'auto',
    },
    accordionDetails: {
        padding: 0,
        display: 'block',
    },
};

type TestConnectionResponse =
    | { result: 'success'; manufacturer?: string; model?: string }
    | { result: 'validationError'; message: string }
    | { result: 'failure'; message: string };

interface SettingsProps {
    native: Record<string, any>;

    onChange: (attr: string, value: any) => void;

    // Wired from App (GenericApp) so the Test Connection button can use sendTo.
    socket?: AdminConnection;
    adapterName?: string;
    instance?: number;
    theme?: IobTheme;
}

type TestStatus =
    | { kind: 'idle' }
    | { kind: 'testing' }
    | { kind: 'success'; manufacturer?: string; model?: string }
    | { kind: 'failure'; message: string };

interface SettingsState {
    testStatus: TestStatus;
}

class Settings extends React.Component<SettingsProps, SettingsState> {
    constructor(props: SettingsProps) {
        super(props);
        this.state = { testStatus: { kind: 'idle' } };
    }

    /**
     * Coerce a raw native field value to a number for numeric config fields.
     *
     * @param value Raw value held in `native` for a numeric field.
     */
    private toNumber(value: any): number | undefined {
        if (value === '' || value === null || value === undefined) {
            return undefined;
        }
        const n = Number(value);
        return Number.isNaN(n) ? undefined : n;
    }

    /** Build the config object from native for validation. */
    private currentConfig(): Partial<ioBroker.AdapterConfig> {
        const { native } = this.props;
        return {
            host: native.host,
            port: this.toNumber(native.port),
            unitId: this.toNumber(native.unitId),
            pollInterval: this.toNumber(native.pollInterval),
        };
    }

    private errors(): ReturnType<typeof validateConfig>['errors'] {
        return validateConfig(this.currentConfig()).errors;
    }

    private renderNumberField(title: string, errorTitle: string, attr: string, hasError: boolean): React.JSX.Element {
        return (
            <TextField
                variant="standard"
                label={I18n.t(title)}
                style={{ ...styles.input, ...styles.controlElement }}
                value={this.props.native[attr] ?? ''}
                type="number"
                error={hasError}
                helperText={hasError ? I18n.t(errorTitle) : ''}
                onChange={e => {
                    const raw = e.target.value;
                    // Keep the value in native (retain-on-invalid handled by admin save layer);
                    // store as number when parseable so validation/bounds apply.
                    const num = raw === '' ? '' : Number(raw);
                    this.props.onChange(attr, num);
                }}
                margin="normal"
            />
        );
    }

    private renderHostField(hasError: boolean): React.JSX.Element {
        return (
            <TextField
                variant="standard"
                label={I18n.t('Host')}
                style={{ ...styles.input, ...styles.controlElement }}
                value={this.props.native.host ?? ''}
                type="text"
                error={hasError}
                helperText={hasError ? I18n.t('Invalid host') : ''}
                onChange={e => this.props.onChange('host', e.target.value)}
                margin="normal"
            />
        );
    }

    private async onTestConnection(): Promise<void> {
        const { socket, adapterName, instance } = this.props;
        if (!socket || !adapterName || instance === undefined || instance === null) {
            this.setState({
                testStatus: { kind: 'failure', message: I18n.t('Connection failed') },
            });
            return;
        }

        const cfg = this.currentConfig();
        this.setState({ testStatus: { kind: 'testing' } });

        try {
            const response = (await socket.sendTo(`${adapterName}.${instance}`, 'testConnection', {
                host: cfg.host,
                port: cfg.port,
                unitId: cfg.unitId,
            })) as unknown as TestConnectionResponse | undefined;

            if (!response) {
                this.setState({ testStatus: { kind: 'failure', message: I18n.t('Connection failed') } });
                return;
            }

            if (response.result === 'success') {
                this.setState({
                    testStatus: {
                        kind: 'success',
                        manufacturer: response.manufacturer,
                        model: response.model,
                    },
                });
            } else {
                this.setState({
                    testStatus: { kind: 'failure', message: response.message || I18n.t('Connection failed') },
                });
            }
        } catch (e: any) {
            this.setState({
                testStatus: { kind: 'failure', message: (e && e.message) || I18n.t('Connection failed') },
            });
        }
    }

    private renderTestStatus(): React.JSX.Element | null {
        const { testStatus } = this.state;

        switch (testStatus.kind) {
            case 'idle':
                return null;
            case 'testing':
                return (
                    <div style={styles.status}>
                        <CircularProgress size={20} />
                        <Typography style={styles.statusText}>{I18n.t('Testing…')}</Typography>
                    </div>
                );
            case 'success': {
                const parts = [testStatus.manufacturer, testStatus.model].filter(Boolean).join(' ');
                const text = parts ? `${I18n.t('Connection successful')} (${parts})` : I18n.t('Connection successful');
                return (
                    <div style={styles.status}>
                        <Typography style={{ ...styles.statusText, ...styles.success }}>{text}</Typography>
                    </div>
                );
            }
            case 'failure':
                return (
                    <div style={styles.status}>
                        <Typography style={{ ...styles.statusText, ...styles.failure }}>
                            {`${I18n.t('Connection failed')}: ${testStatus.message}`}
                        </Typography>
                    </div>
                );
            default:
                return null;
        }
    }

    /**
     * Render the 5-column read-only value table for a single group of defs.
     *
     * @param defs SunSpec register definitions for this group (inverter, meter or battery).
     * @param addressOf Maps a def to the Register-column absolute address. Defaults to
     *   `getRegisterAddress` (inverter/meter). Battery rows pass a device-specific mapper
     *   so the column shows the real battery register address instead of falling through
     *   to INVERTER_BASE.
     */
    private renderTableFor(
        defs: SunSpecRegisterDef[],
        addressOf: (def: SunSpecRegisterDef) => number = getRegisterAddress,
    ): React.JSX.Element {
        return (
            <div style={styles.scrollBox}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>{I18n.t('Name')}</TableCell>
                            <TableCell>{I18n.t('Register')}</TableCell>
                            <TableCell>{I18n.t('Datatype')}</TableCell>
                            <TableCell>{I18n.t('Model')}</TableCell>
                            <TableCell>{I18n.t('Description')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {defs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5}>{I18n.t('No SunSpec values available')}</TableCell>
                            </TableRow>
                        ) : (
                            defs.map(def => (
                                <TableRow key={def.name}>
                                    <TableCell>{def.name}</TableCell>
                                    <TableCell>{addressOf(def)}</TableCell>
                                    <TableCell>{def.datatype}</TableCell>
                                    <TableCell>{String(def.model)}</TableCell>
                                    <TableCell>{def.description ?? ''}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        );
    }

    private renderValueTable(): React.JSX.Element {
        const inverterDefs = getInverterValueDefs();
        const meterDefs = getMeterValueDefs();
        const batteryDefs = getBatteryValueDefs();

        return (
            <Paper style={styles.tableWrapper}>
                <Typography
                    variant="h6"
                    style={{ padding: 8 }}
                >
                    {I18n.t('SunSpec Values')}
                </Typography>

                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Inverter values')} (${inverterDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {this.renderTableFor(inverterDefs)}
                    </AccordionDetails>
                </Accordion>

                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Meter values')} (${meterDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {this.renderTableFor(meterDefs)}
                    </AccordionDetails>
                </Accordion>

                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Battery values')} (${batteryDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {/* Battery rows show the battery.1 absolute register address
                            (getBatteryBase(1) === 0xE100), representative of the per-device
                            battery.<n> channels, since getRegisterAddress does not handle
                            model 'battery'. */}
                        {this.renderTableFor(batteryDefs, def => getDeviceRegisterAddress(getBatteryBase(1), def))}
                    </AccordionDetails>
                </Accordion>
            </Paper>
        );
    }

    render(): React.JSX.Element {
        const errors = this.errors();
        const anyInvalid = Object.keys(errors).length > 0;
        const testing = this.state.testStatus.kind === 'testing';
        const socketAvailable = !!this.props.socket;

        return (
            <form style={{ padding: 16 }}>
                <div>
                    {this.renderHostField(!!errors.host)}
                    {this.renderNumberField('Port', 'Invalid port', 'port', !!errors.port)}
                    {this.renderNumberField('Unit ID', 'Invalid unit ID', 'unitId', !!errors.unitId)}
                    {this.renderNumberField(
                        'Polling interval (s)',
                        'Invalid polling interval',
                        'pollInterval',
                        !!errors.pollInterval,
                    )}
                </div>

                <div>
                    <Button
                        variant="contained"
                        color="primary"
                        style={styles.button}
                        disabled={anyInvalid || testing || !socketAvailable}
                        onClick={() => void this.onTestConnection()}
                    >
                        {I18n.t('Test Connection')}
                    </Button>
                    {this.renderTestStatus()}
                </div>

                {this.renderValueTable()}
            </form>
        );
    }
}

export default Settings;
