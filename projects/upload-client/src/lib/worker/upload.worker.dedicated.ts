/// <reference lib="webworker" />
import { ClientToWorker } from '../messages';
import { WorkerSidePort, WorkerState } from './worker-state';

const state = new WorkerState();
const scope = self as unknown as DedicatedWorkerGlobalScope;

const port: WorkerSidePort = {
  postMessage: (msg) => scope.postMessage(msg),
};
state.attachPort(port);
scope.onmessage = (e: MessageEvent<ClientToWorker>) => {
  state.handleMessage(port, e.data);
};
