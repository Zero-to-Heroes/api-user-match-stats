import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	try {
		const mysql = await getConnection();
		// console.log('input', JSON.stringify(event));
		const input: string = event.pathParameters && event.pathParameters.proxy;
		const userToken = input ? (input.indexOf('/') === -1 ? input : input.split('/')[0]) : null;
		const targetReviewId = input ? (input?.indexOf('/') === -1 ? undefined : input.split('/')[1]) : null;
		const startDate = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
		// This request is complex because the matches are associated to a userId,
		// which (I learnt too late unfortunately) are not a 1-1 mapping with a username
		// It queries against both a username and a userId so that I can later
		// change the input to be the username if it exists
		const userIdFromToken = userToken?.includes('overwolf-') ? userToken?.split('overwolf-')[1] : userToken;
		const userInput = JSON.parse(event.body);
		console.log('getting stats for user', userToken, targetReviewId, userInput?.userName);
		// First need to add the userName column, then populate it with new process, then with hourly sync process
		const query = `
			SELECT * FROM replay_summary 
			WHERE (
				uploaderToken = '${userInput?.uploaderToken || userToken}'
				OR userId = '${userInput?.userId || userIdFromToken}'
				OR userName = '${userInput?.userName || 'invalid_user_name'}'
			)
			AND creationDate > '${startDate.toISOString()}'
			ORDER BY creationDate DESC
		`;
		console.log('prepared query', query);
		const dbResults: readonly any[] = await mysql.query(query);
		console.log('executed query', dbResults && dbResults.length, dbResults && dbResults.length > 0 && dbResults[0]);

		const results: readonly GameStat[] =
			!dbResults || (targetReviewId && !dbResults.some(result => result.reviewId === targetReviewId))
				? []
				: dbResults.map(result =>
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
							newPlayerRank: result.newPlayerRank,
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
		console.log('results filtered', results.length);

		const stringResults = JSON.stringify({ results });
		const gzippedResults = gzipSync(stringResults).toString('base64');
		console.log('compressed', stringResults.length, gzippedResults.length);
		const response = {
			statusCode: 200,
			isBase64Encoded: true,
			body: gzippedResults,
			headers: {
				'Content-Type': 'text/html',
				'Content-Encoding': 'gzip',
			},
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
	readonly gameMode:
		| 'arena'
		| 'arena-draft'
		| 'casual'
		| 'friendly'
		| 'practice'
		| 'ranked'
		| 'tavern-brawl'
		| 'battlegrounds';
	readonly gameFormat: 'standard' | 'wild';
	readonly buildNumber: number | undefined;
	readonly scenarioId: number | undefined;
	readonly result: 'won' | 'lost' | 'tied';
	readonly coinPlay: 'coin' | 'play';
	readonly playerName: string;
	readonly playerClass: string;
	readonly playerRank: string | undefined;
	readonly newPlayerRank: string | undefined;
	readonly playerCardId: string;
	readonly playerDecklist: string | undefined;
	readonly playerDeckName: string | undefined;
	readonly opponentClass: string;
	readonly opponentRank: string | undefined;
	readonly opponentCardId: string;
	readonly opponentName: string;
	readonly reviewId: string;
}
