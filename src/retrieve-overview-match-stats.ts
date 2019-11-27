import { Rds } from './db/rds';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	try {
		const rds = await Rds.getInstance();
		console.log('input', JSON.stringify(event));
		const userToken = event.pathParameters && event.pathParameters.proxy;
		console.log('getting stats for user', userToken);
		const dbResults = await rds.runQuery<readonly any[]>(
			`
			SELECT * FROM replay_summary 
			WHERE uploaderToken = '${userToken}'
			ORDER BY creationDate DESC
			LIMIT 100
		`,
		);
		const results: readonly GameStat[] = dbResults.map(result =>
			Object.assign(new GameStat(), {
				additionalResult: result.additionalResult,
				coinPlay: result.coinPlay,
				creationTimestamp: Date.parse(result.creationDate),
				gameFormat: result.gameFormat,
				gameMode: result.gameMode,
				opponentCardId: result.opponentCardId,
				opponentClass: result.opponentClass,
				playerName: result.playerName,
				playerCardId: result.playerCardId,
				playerClass: result.playerClass,
				playerRank: result.playerRank,
				playerDeckName: result.playerDeckName,
				playerDecklist: result.playerDecklist,
				buildNumber: result.buildNumber,
				scenarioId: result.scenarioId,
				opponentRank: result.opponentRank,
				opponentName: result.opponentName,
				result: result.result,
				reviewId: result.reviewId,
			} as GameStat),
		);
		const response = {
			statusCode: 200,
			isBase64Encoded: false,
			body: JSON.stringify({ results }),
		};
		console.log('sending back success reponse');
		return response;
	} catch (e) {
		console.error('issue retrieving stats', e);
		const response = {
			statusCode: 500,
			isBase64Encoded: false,
			body: JSON.stringify({ message: 'not ok', exception: e }),
		};
		console.log('sending back error reponse', response);
		return response;
	}
};

class GameStat {
	readonly additionalResult: string;
	readonly creationTimestamp: number;
	readonly gameMode: 'arena' | 'arena-draft' | 'casual' | 'friendly' | 'practice' | 'ranked' | 'tavern-brawl' | 'battlegrounds';
	readonly gameFormat: 'standard' | 'wild';
	readonly buildNumber: number | undefined;
	readonly scenarioId: number | undefined;
	readonly result: 'won' | 'lost' | 'tied';
	readonly coinPlay: 'coin' | 'play';
	readonly playerName: string;
	readonly playerClass: string;
	readonly playerRank: string | undefined;
	readonly playerCardId: string;
	readonly playerDecklist: string | undefined;
	readonly playerDeckName: string | undefined;
	readonly opponentClass: string;
	readonly opponentRank: string | undefined;
	readonly opponentCardId: string;
	readonly opponentName: string;
	readonly reviewId: string;
}
