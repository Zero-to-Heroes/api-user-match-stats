/* eslint-disable @typescript-eslint/no-use-before-define */
import { Race } from '@firestone-hs/reference-data';
import SqlString from 'sqlstring';
import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const escape = SqlString.escape;
	const mysql = await getConnection();
	const startDate = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
	// This request is complex because the matches are associated to a userId,
	// which (I learnt too late unfortunately) are not a 1-1 mapping with a username
	// It queries against both a username and a userId so that I can later
	// change the input to be the username if it exists

	const userInput = JSON.parse(event.body);
	if (!userInput) {
		console.warn('trying to get match stats without input, returning');
		return;
	}

	const userIds = await getValidUserInfo(userInput.userId, userInput.userName, mysql);

	// First need to add the userName column, then populate it with new process, then with hourly sync process
	const userNameCrit = userInput?.userName ? `OR userName = ${escape(userInput.userName)}` : '';
	const query = `
			SELECT * FROM replay_summary
			WHERE userId IN (${escape(userIds)})
			AND creationDate > ${escape(startDate.toISOString())}
			ORDER BY creationDate DESC
		`;
	console.log('running query', query);
	const dbResults: readonly any[] = await mysql.query(query);
	console.log('query over');
	await mysql.end();

	const results: readonly GameStat[] = dbResults.map(review => buildReviewData(review));

	const stringResults = JSON.stringify({ results });
	const gzippedResults = gzipSync(stringResults).toString('base64');
	const response = {
		statusCode: 200,
		isBase64Encoded: true,
		body: gzippedResults,
		headers: {
			'Content-Type': 'text/html',
			'Content-Encoding': 'gzip',
		},
	};
	return response;
};

const getValidUserInfo = async (userId: string, userName: string, mysql): Promise<readonly string[]> => {
	const escape = SqlString.escape;
	const userSelectQuery = `
			SELECT DISTINCT userId FROM user_mapping
			INNER JOIN (
				SELECT DISTINCT username FROM user_mapping
				WHERE 
					(username = ${escape(userName)} OR username = ${escape(userId)} OR userId = ${escape(userId)})
					AND username IS NOT NULL
					AND username != ''
					AND username != 'null'
					AND userId != ''
					AND userId IS NOT NULL
					AND userId != 'null'
			) AS x ON x.username = user_mapping.username
			UNION ALL SELECT ${escape(userId)}
		`;
	console.log('running query', userSelectQuery);
	const userIds: any[] = await mysql.query(userSelectQuery);
	console.log('query over', userIds);
	return userIds.map(result => result.userId);
};

const buildReviewData = (mainReview: any): GameStat => {
	const bgsAvailableTribes: readonly Race[] = !mainReview.bgsAvailableTribes?.length
		? []
		: mainReview.bgsAvailableTribes.split(',').map(tribe => parseInt(tribe));
	return {
		additionalResult: mainReview.additionalResult,
		coinPlay: mainReview.coinPlay,
		creationTimestamp: Date.parse(mainReview.creationDate),
		gameFormat: mainReview.gameFormat,
		gameMode: mainReview.gameMode,
		opponentCardId: mainReview.opponentCardId,
		opponentClass: mainReview.opponentClass,
		playerName: mainReview.playerName,
		playerCardId: mainReview.playerCardId,
		playerClass: mainReview.playerClass,
		playerRank: mainReview.playerRank,
		newPlayerRank: mainReview.newPlayerRank,
		playerDeckName: mainReview.playerDeckName,
		playerDecklist: mainReview.playerDecklist,
		buildNumber: mainReview.buildNumber,
		scenarioId: mainReview.scenarioId,
		opponentRank: mainReview.opponentRank,
		opponentName: mainReview.opponentName,
		result: mainReview.result,
		reviewId: mainReview.reviewId,
		// Fill in with other stats here
		gameDurationSeconds: mainReview.totalDurationSeconds,
		gameDurationTurns: mainReview.totalDurationTurns,
		currentDuelsRunId: mainReview.runId,
		runId: mainReview.runId,
		playerArchetypeId: mainReview.playerArchetypeId,
		opponentArchetypeId: mainReview.opponentArchetypeId,
		bgsAvailableTribes: bgsAvailableTribes,
		finalComp: mainReview.finalComp,
		levelAfterMatch: mainReview.levelAfterMatch,

		mercHeroTimings: !!mainReview.mercHeroTimings
			? mainReview.mercHeroTimings.split(',').map(timing => ({
					heroCardId: timing.split('|')[0],
					turnInPlay: timing.split('|')[1],
			  }))
			: null,
		mercOpponentHeroTimings: !!mainReview.mercOpponentHeroTimings
			? mainReview.mercOpponentHeroTimings.split(',').map(timing => ({
					cardId: timing.split('|')[0],
					turnInPlay: timing.split('|')[1],
			  }))
			: null,
	} as GameStat;
};

// const findStat = (reviews: readonly any[], statName: string): number => {
// 	return reviews.find(review => review.statName === statName)?.statValue;
// };

interface GameStat {
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
		| 'battlegrounds'
		| 'duels'
		| 'paid-duels';
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
	readonly gameDurationSeconds: number;
	readonly gameDurationTurns: number;
	readonly playerArchetypeId: string;
	readonly opponentArchetypeId: string;
	readonly finalComp: string;
	readonly mercHeroTimings: readonly { cardId: string; turnInPlay: number }[];
	readonly mercOpponentHeroTimings: readonly { cardId: string; turnInPlay: number }[];
}
