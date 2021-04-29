/* eslint-disable @typescript-eslint/no-use-before-define */
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
	console.log('getting stats for user', JSON.stringify(userInput));
	if (!userInput) {
		console.warn('trying to get match stats without input, returning');
		return;
	}

	// First need to add the userName column, then populate it with new process, then with hourly sync process
	// bgs-hero-pick-choice is here to accomodate the early BG games that don't have other info in
	// match_stats
	const userNameCrit = userInput?.userName ? `OR t1.userName = ${escape(userInput.userName)}` : '';
	const query = `
			SELECT t1.*, t2.totalDurationSeconds, t2.totalDurationTurns, t2.duelsRunId, t3.playerArchetypeId, t3.opponentArchetypeId
			FROM replay_summary t1
			LEFT OUTER JOIN replay_summary_secondary_data t2 ON t1.reviewId = t2.reviewId
			LEFT OUTER JOIN ranked_decks t3 ON t1.reviewId = t3.reviewId
			WHERE (
				t1.uploaderToken = ${escape(userInput.uploaderToken)}
				OR t1.userId = ${escape(userInput?.userId)}
				${userNameCrit}
			)
			AND t1.creationDate > ${escape(startDate.toISOString())}
			ORDER BY t1.creationDate DESC
		`;
	console.log('prepared query', query);
	const dbResults: readonly any[] = await mysql.query(query);
	console.log('executed query', dbResults && dbResults.length, dbResults && dbResults.length > 0 && dbResults[0]);
	await mysql.end();

	// console.log('groupedByRelatedReviews', groupedByRelatedReviews.length);
	const results: readonly GameStat[] = dbResults.map(review => buildReviewData(review));
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
};

const buildReviewData = (mainReview: any): GameStat => {
	// console.log('building review data for', reviewId, mainReview, relevantReviews, dbResults);
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
		currentDuelsRunId: mainReview.duelsRunId,
		playerArchetypeId: mainReview.playerArchetypeId,
		opponentArchetypeId: mainReview.opponentArchetypeId,
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
}
