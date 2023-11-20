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
	if (!event.body?.length) {
		return {
			statusCode: 404,
			isBase64Encoded: true,
			body: null,
			headers: {
				'Content-Type': 'text/html',
				'Content-Encoding': 'gzip',
			},
		};
	}
	try {
		JSON.parse(event.body);
	} catch (e) {
		console.error('could not parse event body', event.body, event);
	}

	const userInput = JSON.parse(event.body);
	if (!userInput) {
		console.warn('trying to get match stats without input, returning');
		return;
	}

	const startDate = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
	const startDateCriteria = userInput.fullRetrieve ? '' : `AND creationDate > ${escape(startDate.toISOString())}`;

	// This request is complex because the matches are associated to a userId,
	// which (I learnt too late unfortunately) are not a 1-1 mapping with a username
	// It queries against both a username and a userId so that I can later
	// change the input to be the username if it exists
	const userIds = await getValidUserInfo(userInput.userId, userInput.userName, mysql);

	// First need to add the userName column, then populate it with new process, then with hourly sync process
	// const userNameCrit = userInput?.userName ? `OR userName = ${escape(userInput.userName)}` : '';
	const query = `
		SELECT * FROM replay_summary
		WHERE userId IN (${escape(userIds)})
		${startDateCriteria}
		ORDER BY creationDate DESC
	`;
	console.log('running query', query);
	const dbResults: readonly any[] = await mysql.query(query);
	console.log('query over', dbResults?.length);
	await mysql.end();

	const results: readonly GameStat[] = dbResults.map((review) => buildReviewData(review));

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
	return userIds.map((result) => result.userId);
};

const buildReviewData = (review: any): GameStat => {
	const bgsAvailableTribes: readonly Race[] = !review.bgsAvailableTribes?.length
		? []
		: review.bgsAvailableTribes.split(',').map((tribe) => parseInt(tribe));
	return {
		additionalResult: review.additionalResult,
		coinPlay: review.coinPlay,
		creationTimestamp: Date.parse(review.creationDate),
		gameFormat: review.gameFormat,
		gameMode: review.gameMode,
		opponentCardId: review.opponentCardId,
		opponentClass: review.opponentClass,
		playerName: review.playerName,
		playerCardId: review.playerCardId,
		playerClass: review.playerClass,
		playerRank: review.playerRank,
		newPlayerRank: review.newPlayerRank,
		playerDeckName: review.playerDeckName,
		playerDecklist: review.playerDecklist,
		buildNumber: review.buildNumber,
		scenarioId: review.scenarioId,
		opponentRank: review.opponentRank,
		opponentName: review.opponentName,
		result: review.result,
		reviewId: review.reviewId,
		// Fill in with other stats here
		gameDurationSeconds: review.totalDurationSeconds,
		gameDurationTurns: review.totalDurationTurns,
		currentDuelsRunId: review.runId,
		runId: review.runId,
		playerArchetypeId: review.playerArchetypeId,
		opponentArchetypeId: review.opponentArchetypeId,
		bgsAvailableTribes: bgsAvailableTribes,
		bgsAnomalies: review.bgsAnomalies?.split(',') ?? [],
		finalComp: review.finalComp,
		levelAfterMatch: review.levelAfterMatch,
		bgsPerfectGame: review.bgsPerfectGame === 1,
		bgsHasPrizes: review.bgsHasPrizes,
		bgsHasQuests: review.bgsHasQuests,
		bgsHeroQuests: review.bgsHeroQuests?.split(','),
		bgsQuestsCompletedTimings: review.bgsQuestsCompletedTimings?.split(','),
		bgsHeroQuestRewards: review.bgsHeroQuestRewards?.split(','),
		region: review.region,

		mercHeroTimings:
			!!review.mercHeroTimings?.length && review.mercHeroTimings.includes(',')
				? review.mercHeroTimings.split(',').map((timing) => ({
						cardId: timing.split('|')[0],
						turnInPlay: +timing.split('|')[1],
				  }))
				: null,
		mercOpponentHeroTimings:
			!!review.mercOpponentHeroTimings?.length && review.mercOpponentHeroTimings.includes(',')
				? review.mercOpponentHeroTimings.split(',').map((timing) => ({
						cardId: timing.split('|')[0],
						turnInPlay: +timing.split('|')[1],
				  }))
				: null,
		mercEquipments:
			!!review.mercHeroEquipments?.length && review.mercHeroEquipments.includes(',')
				? review.mercHeroEquipments
						.split(',')
						.map((equip: string) => {
							const equipmentCardId = equip.split('|')[1];
							return !equipmentCardId?.length || equipmentCardId == '0'
								? null
								: {
										mercCardId: equip.split('|')[0],
										equipmentCardId: equipmentCardId,
								  };
						})
						.filter((equip) => !!equip)
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
	readonly bgsHasQuests: boolean;
	readonly bgsHeroQuests: readonly string[];
	readonly bgsQuestsCompletedTimings: readonly number[];
	readonly bgsHeroQuestRewards: readonly string[];
	readonly bgsAnomalies: readonly string[];
}
