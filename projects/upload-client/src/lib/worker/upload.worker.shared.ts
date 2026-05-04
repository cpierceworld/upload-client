/// <reference lib="webworker" />
import { ClientToWorker } from '../messages';
import { WorkerState } from './worker-state';

const state = new WorkerState();
const scope = self as unknown as SharedWorkerGlobalScope;

scope.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  state.attachPort(port);
  port.onmessage = (msg: MessageEvent<ClientToWorker>) => {
    state.handleMessage(port, msg.data);
  };
  port.start();
};
