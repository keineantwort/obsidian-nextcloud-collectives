import { CollectivesApi } from './collectivesApi';
import { HttpClient, type HttpClientOptions } from './http';
import { OcsClient } from './ocsClient';
import { WebdavClient } from './webdavClient';

export interface ApiClients {
	http: HttpClient;
	ocs: OcsClient;
	webdav: WebdavClient;
	collectives: CollectivesApi;
}

/** Wires the clients for one server connection. */
export function createApiClients(options: HttpClientOptions): ApiClients {
	const http = new HttpClient(options);
	const ocs = new OcsClient(http);
	return { http, ocs, webdav: new WebdavClient(http), collectives: new CollectivesApi(ocs) };
}
