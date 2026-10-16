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

/**
 * Wires the clients for one server connection. `davUserId` is the Nextcloud user ID used for WebDAV paths;
 * without it the login name is used.
 */
export function createApiClients(options: HttpClientOptions, davUserId?: string): ApiClients {
	const http = new HttpClient(options);
	const ocs = new OcsClient(http);
	return { http, ocs, webdav: new WebdavClient(http, davUserId), collectives: new CollectivesApi(ocs) };
}
