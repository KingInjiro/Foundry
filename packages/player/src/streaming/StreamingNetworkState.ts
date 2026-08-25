export type StreamingConnectionClass =
    | 'OFFLINE'
    | 'SLOW'
    | 'MODERATE'
    | 'FAST'
    | 'UNKNOWN';

export interface StreamingNetworkState {
    connectionClass: StreamingConnectionClass;
    saveData: boolean;
    online: boolean;
}

export class StreamingNetworkObserver {
    public static getState(): StreamingNetworkState {
        const state: StreamingNetworkState = {
            connectionClass: 'UNKNOWN',
            saveData: false,
            online: true
        };

        if (typeof navigator !== 'undefined') {
            if ('onLine' in navigator) {
                state.online = navigator.onLine;
            }

            const nav = navigator as any;
            if (nav.connection) {
                if ('saveData' in nav.connection) {
                    state.saveData = nav.connection.saveData === true;
                }

                if (nav.connection.effectiveType) {
                    switch (nav.connection.effectiveType) {
                        case 'slow-2g':
                        case '2g':
                            state.connectionClass = 'SLOW';
                            break;
                        case '3g':
                            state.connectionClass = 'MODERATE';
                            break;
                        case '4g':
                            state.connectionClass = 'FAST';
                            break;
                        default:
                            state.connectionClass = 'UNKNOWN';
                            break;
                    }
                }
            }
            
            if (!state.online) {
                state.connectionClass = 'OFFLINE';
            }
        }

        return state;
    }
}
