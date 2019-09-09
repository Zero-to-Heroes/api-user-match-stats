import { SecretsManager } from 'aws-sdk';
import { GetSecretValueRequest, GetSecretValueResponse } from 'aws-sdk/clients/secretsmanager';
import { createConnection } from 'mysql';

const secretsManager = new SecretsManager({ region: 'us-west-2' });

const getSecret = async (secretRequest: GetSecretValueRequest) => {
	return new Promise<SecretInfo>(resolve => {
		secretsManager.getSecretValue(secretRequest, (err, data: GetSecretValueResponse) => {
			const secretInfo: SecretInfo = JSON.parse(data.SecretString);
			resolve(secretInfo);
		});
	});
};

const runQuery = async (secretResponse: SecretInfo, query: string): Promise<readonly GameStat[]> => {
	return new Promise<readonly GameStat[]>((resolve, reject) => {
		console.log('running query', query);
		try {
			const connection = createConnection({
				host: secretResponse.host,
				user: secretResponse.username,
				password: secretResponse.password,
				port: secretResponse.port,
				charset: 'utf8',
				database: 'replay_summary',
			});
			console.log('connection created');
			connection.query(query, (error, results, fields) => {
				if (error) {
					connection.destroy();
					reject();
				} else {
					const transformedResults: readonly GameStat[] = results.map(result =>
						Object.assign(new GameStat(), {
							coinPlay: result.coinPlay,
							creationTimestamp: Date.parse(result.creationDate),
							gameFormat: result.gameFormat,
							gameMode: result.gameMode,
							opponentCardId: result.opponentCardId,
							opponentClass: result.opponentClass,
							playerCardId: result.playerCardId,
							playerClass: result.playerClass,
							result: result.result,
						} as GameStat),
					);
					console.log('found', transformedResults.length, 'results');
					resolve(transformedResults);
				}
			});
		} catch (e) {
			console.error('Could not connect to DB', e);
		}
	});
};

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	try {
		console.log('input', JSON.stringify(event));
		const userToken = event.pathParameters && event.pathParameters.proxy;
		console.log('getting stats for user', userToken);
		const secretRequest: GetSecretValueRequest = {
			SecretId: 'rds-connection',
		};
		const secretResponse: SecretInfo = await getSecret(secretRequest);
		console.log('secret response built');
		const results: readonly GameStat[] = await runQuery(
			secretResponse,
			`
			SELECT * FROM replay_summary 
			WHERE uploaderToken = '${userToken}'
			ORDER BY creationDate DESC
			LIMIT 100
		`,
		);
		const response = {
			statusCode: 200,
			isBase64Encoded: false,
			body: JSON.stringify({ results }),
		};
		console.log('sending back success reponse');
		return response;
	} catch (e) {
		const response = {
			statusCode: 500,
			isBase64Encoded: false,
			body: JSON.stringify({ message: 'not ok', exception: e }),
		};
		console.log('sending back error reponse', response);
		return response;
	}
};

interface SecretInfo {
	readonly username: string;
	readonly password: string;
	readonly host: string;
	readonly port: number;
	readonly dbClusterIdentifier: string;
}

class GameStat {
	readonly coinPlay: 'coin' | 'play';
	readonly opponentClass: string;
	readonly playerClass: string;
	// readonly playerDecklist: string | undefined; // This is not well handled on the server side yet
	readonly result: 'won' | 'lost' | 'tied';
	readonly gameMode: 'arena' | 'arena-draft' | 'casual' | 'friendly' | 'practice' | 'ranked' | 'tavern-brawl';
	readonly creationTimestamp: number;
	readonly gameFormat: 'standard' | 'wild';
	readonly playerCardId: string;
	readonly opponentCardId: string;
}
