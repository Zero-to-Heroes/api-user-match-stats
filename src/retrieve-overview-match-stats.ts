/* eslint-disable @typescript-eslint/no-use-before-define */
import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';
import { groupByFunction } from './utils';

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
		// bgs-hero-pick-choice is here to accomodate the early BG games that don't have other info in
		// match_stats
		const query = `
			SELECT t1.*, statName, statValue FROM replay_summary t1
			LEFT OUTER JOIN match_stats t2
			ON t1.reviewId = t2.reviewId
			WHERE (
				t1.uploaderToken = '${userInput?.uploaderToken || userToken}'
				OR t1.userId = '${userInput?.userId || userIdFromToken}'
				OR t1.userName = '${userInput?.userName || 'invalid_user_name'}'
			)
			AND t1.creationDate > '${startDate.toISOString()}'
			AND (
				t2.statName is null 
				OR t2.statName in ('total-duration-seconds', 'total-duration-turns', 'duels-run-id', 'bgs-hero-pick-choice')
			)
			ORDER BY t1.creationDate DESC
		`;
		console.log('prepared query', query);
		const dbResults: readonly any[] = await mysql.query(query);
		console.log('executed query', dbResults && dbResults.length, dbResults && dbResults.length > 0 && dbResults[0]);

		// Merging results
		const allReviewIds: readonly string[] =
			!dbResults || (targetReviewId && !dbResults.some(result => result.reviewId === targetReviewId))
				? []
				: dbResults.map(result => result.reviewId as string);

		// console.log('all review ids', allReviewIds);
		const uniqueReviewIds: readonly string[] = [...new Set(allReviewIds)];
		console.log('uniqueReviewIds', uniqueReviewIds.length);

		const groupedByReviewId: { [reviewId: string]: readonly any[] } = groupByFunction(
			(result: any) => result.reviewId,
		)(dbResults);
		console.log('groupedByReviewId', Object.keys(groupedByReviewId)?.length);

		// const groupedByRelatedReviews = uniqueReviewIds.map(reviewId =>
		// 	dbResults.filter(review => review.reviewId === reviewId),
		// );
		// console.log('groupedByRelatedReviews', groupedByRelatedReviews.length);
		const results: readonly GameStat[] = Object.values(groupedByReviewId).map(reviews => buildReviewData(reviews));
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

const buildReviewData = (relatedReviews: readonly any[]): GameStat => {
	const mainReview = relatedReviews[0];
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
		// CAREFUL: add the stat you want to the main query, so it gets fetched from the DB in the first place
		gameDurationSeconds: findStat(relatedReviews, 'total-duration-seconds'),
		gameDurationTurns: findStat(relatedReviews, 'total-duration-turns'),
		currentDuelsRunId: findStat(relatedReviews, 'duels-run-id'),
		// currentPaidDuelsRunId: findStat(relevantReviews, 'paid-duels-run-id'),
	} as GameStat;
};

const findStat = (reviews: readonly any[], statName: string): number => {
	return reviews.find(review => review.statName === statName)?.statValue;
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
}
