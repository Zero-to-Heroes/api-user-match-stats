import { SecretsManager } from 'aws-sdk';
import { GetSecretValueRequest, GetSecretValueResponse } from 'aws-sdk/clients/secretsmanager';
import { createPool, Pool } from 'mysql';

const secretsManager = new SecretsManager({ region: 'us-west-2' });

export class Rds {
	private static instance: Rds;

	private pool: Pool;

	public static async getInstance(): Promise<Rds> {
		if (!Rds.instance) {
			Rds.instance = new Rds();
			await Rds.instance.init();
		}
		return Rds.instance;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	private constructor() {}

	private async init() {
		this.pool = await this.buildPool();
	}

	private async getSecret(secretRequest: GetSecretValueRequest) {
		return new Promise<SecretInfo>(resolve => {
			secretsManager.getSecretValue(secretRequest, (err, data: GetSecretValueResponse) => {
				const secretInfo: SecretInfo = JSON.parse(data.SecretString);
				resolve(secretInfo);
			});
		});
	}

	private async buildPool(): Promise<Pool> {
		const secretRequest: GetSecretValueRequest = {
			SecretId: 'rds-connection',
		};
		const secretResponse: SecretInfo = await this.getSecret(secretRequest);
		return createPool({
			connectionLimit: 5,
			host: secretResponse.host,
			user: secretResponse.username,
			password: secretResponse.password,
			port: secretResponse.port,
			charset: 'utf8',
			database: 'replay_summary',
		});
	}

	public async runQuery<T>(query: string): Promise<T> {
		return new Promise<T>(async (resolve, reject) => {
			try {
				this.pool.getConnection((err, connection) => {
					if (err) {
						connection.release();
						console.log('issue getting connection', err);
						reject();
						return;
					}
					console.log('connection created');
					connection.query(query, (error, results, fields) => {
						connection.release();
						if (error) {
							console.log('issue running query', error, query);
							reject();
						} else {
							resolve(results as T);
						}
					});

					connection.on('error', function(err) {
						console.error('Issue in connection', err);
						reject();
						return;
					});
				});
			} catch (e) {
				console.error('Could not connect to DB', e);
			}
		});
	}
}

interface SecretInfo {
	readonly username: string;
	readonly password: string;
	readonly host: string;
	readonly port: number;
	readonly dbClusterIdentifier: string;
}
