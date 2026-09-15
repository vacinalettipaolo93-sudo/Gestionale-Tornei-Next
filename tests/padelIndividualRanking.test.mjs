import test from 'node:test';
import assert from 'node:assert/strict';

const MASTER_SIZE = 16;
const MASTER_MIN_MATCHES = 6;
const PARTICIPATION_POINTS = 5;
const PARTICIPATION_MONTHLY_CAP = 20;
const WON_GAMES_CAP = 5;

const getBand = diff => diff <= 99 ? 'balanced' : diff <= 199 ? 'medium' : 'high';

const getResultPoints = (band, isFavorite, won) => {
  if (band === 'balanced') return won ? 20 : -20;
  if (band === 'medium') return isFavorite ? (won ? 15 : -25) : (won ? 25 : -15);
  return isFavorite ? (won ? 10 : -30) : (won ? 30 : 10);
};

const getMonthKey = iso => {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

function calculateRanking(players, matches) {
  const stats = new Map(players.map(player => [player.id, {
    points: player.start,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    participationBonus: 0,
    wonGamesBonus: 0,
    resultPoints: 0,
    partners: new Set(),
  }]));
  const monthlyCounts = new Map();

  matches
    .slice()
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .forEach(match => {
      const team1 = match.team1;
      const team2 = match.team2;
      const team1Total = team1.reduce((sum, playerId) => sum + stats.get(playerId).points, 0);
      const team2Total = team2.reduce((sum, playerId) => sum + stats.get(playerId).points, 0);
      const favoriteSide = team1Total === team2Total ? null : (team1Total > team2Total ? 1 : 2);
      const band = getBand(Math.abs(team1Total - team2Total));
      const team1Won = match.score1 > match.score2;
      const team1Result = getResultPoints(band, favoriteSide === 1, team1Won);
      const team2Result = getResultPoints(band, favoriteSide === 2, !team1Won);
      const team1Games = Math.min(match.score1, WON_GAMES_CAP);
      const team2Games = Math.min(match.score2, WON_GAMES_CAP);

      for (const playerId of team1) {
        const stat = stats.get(playerId);
        const monthKey = `${playerId}:${getMonthKey(match.completedAt)}`;
        const currentMonthCount = monthlyCounts.get(monthKey) ?? 0;
        monthlyCounts.set(monthKey, currentMonthCount + 1);
        const participation = currentMonthCount * PARTICIPATION_POINTS >= PARTICIPATION_MONTHLY_CAP ? 0 : PARTICIPATION_POINTS;
        const total = team1Result + team1Games + participation;
        stat.points += total;
        stat.matchesPlayed += 1;
        stat.resultPoints += team1Result;
        stat.participationBonus += participation;
        stat.wonGamesBonus += team1Games;
        stat.partners.add(team1.find(id => id !== playerId));
        if (team1Won) stat.wins += 1;
        else stat.losses += 1;
      }

      for (const playerId of team2) {
        const stat = stats.get(playerId);
        const monthKey = `${playerId}:${getMonthKey(match.completedAt)}`;
        const currentMonthCount = monthlyCounts.get(monthKey) ?? 0;
        monthlyCounts.set(monthKey, currentMonthCount + 1);
        const participation = currentMonthCount * PARTICIPATION_POINTS >= PARTICIPATION_MONTHLY_CAP ? 0 : PARTICIPATION_POINTS;
        const total = team2Result + team2Games + participation;
        stat.points += total;
        stat.matchesPlayed += 1;
        stat.resultPoints += team2Result;
        stat.participationBonus += participation;
        stat.wonGamesBonus += team2Games;
        stat.partners.add(team2.find(id => id !== playerId));
        if (team1Won) stat.losses += 1;
        else stat.wins += 1;
      }
    });

  const ranking = players.map(player => {
    const stat = stats.get(player.id);
    return {
      id: player.id,
      points: stat.points,
      matchesPlayed: stat.matchesPlayed,
      wins: stat.wins,
      losses: stat.losses,
      participationBonus: stat.participationBonus,
      wonGamesBonus: stat.wonGamesBonus,
      resultPoints: stat.resultPoints,
      distinctPartners: stat.partners.size,
      eligibleForMaster: stat.matchesPlayed >= MASTER_MIN_MATCHES,
    };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins || b.matchesPlayed - a.matchesPlayed || a.id.localeCompare(b.id));

  const qualifiedIds = ranking.filter(entry => entry.eligibleForMaster).slice(0, MASTER_SIZE).map(entry => entry.id);
  ranking.forEach(entry => {
    entry.qualifiedForMaster = qualifiedIds.includes(entry.id);
  });
  return ranking;
}

test('balanced band awards +20/-20 to every player on the winning/losing pair', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1000 },
      { id: 'b', start: 1000 },
      { id: 'c', start: 1000 },
      { id: 'd', start: 1000 },
    ],
    [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-01-10T10:00:00.000Z' }],
  );

  const a = ranking.find(entry => entry.id === 'a');
  const c = ranking.find(entry => entry.id === 'c');
  assert.equal(a.resultPoints, 20);
  assert.equal(c.resultPoints, -20);
});

test('medium-difference favorite win and underdog loss follow the requested values', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1100 },
      { id: 'b', start: 1050 },
      { id: 'c', start: 1000 },
      { id: 'd', start: 1000 },
    ],
    [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 3, completedAt: '2026-01-11T10:00:00.000Z' }],
  );

  assert.equal(ranking.find(entry => entry.id === 'a').resultPoints, 15);
  assert.equal(ranking.find(entry => entry.id === 'c').resultPoints, -15);
});

test('medium-difference underdog win and favorite loss follow the requested values', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1100 },
      { id: 'b', start: 1050 },
      { id: 'c', start: 1000 },
      { id: 'd', start: 1000 },
    ],
    [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 3, score2: 6, completedAt: '2026-01-12T10:00:00.000Z' }],
  );

  assert.equal(ranking.find(entry => entry.id === 'c').resultPoints, 25);
  assert.equal(ranking.find(entry => entry.id === 'a').resultPoints, -25);
});

test('high-difference underdog loss keeps the requested positive +10', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1400 },
      { id: 'b', start: 1200 },
      { id: 'c', start: 900 },
      { id: 'd', start: 800 },
    ],
    [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 1, completedAt: '2026-01-13T10:00:00.000Z' }],
  );

  assert.equal(ranking.find(entry => entry.id === 'a').resultPoints, 10);
  assert.equal(ranking.find(entry => entry.id === 'c').resultPoints, 10);
});

test('monthly participation bonus is capped at +20 per player', () => {
  const basePlayers = [
    { id: 'a', start: 1000 },
    { id: 'b', start: 1000 },
    { id: 'c', start: 1000 },
    { id: 'd', start: 1000 },
  ];
  const matches = [1, 2, 3, 4, 5].map(index => ({
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    score1: 6,
    score2: 4,
    completedAt: `2026-02-${String(index).padStart(2, '0')}T10:00:00.000Z`,
  }));
  const ranking = calculateRanking(basePlayers, matches);

  assert.equal(ranking.find(entry => entry.id === 'a').participationBonus, 20);
  assert.equal(ranking.find(entry => entry.id === 'c').participationBonus, 20);
});

test('won-games bonus is capped at +5 per player and per match', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1000 },
      { id: 'b', start: 1000 },
      { id: 'c', start: 1000 },
      { id: 'd', start: 1000 },
    ],
    [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 7, score2: 6, completedAt: '2026-03-10T10:00:00.000Z' }],
  );

  assert.equal(ranking.find(entry => entry.id === 'a').wonGamesBonus, 5);
  assert.equal(ranking.find(entry => entry.id === 'c').wonGamesBonus, 5);
});

test('editing and re-saving a result recalculates from history without duplicating derived points', () => {
  const players = [
    { id: 'a', start: 1000 },
    { id: 'b', start: 1000 },
    { id: 'c', start: 1000 },
    { id: 'd', start: 1000 },
  ];
  const original = calculateRanking(players, [
    { id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-04-10T10:00:00.000Z' },
  ]);
  const edited = calculateRanking(players, [
    { id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 4, score2: 6, completedAt: '2026-04-10T10:00:00.000Z' },
  ]);

  assert.equal(original.find(entry => entry.id === 'a').matchesPlayed, 1);
  assert.equal(edited.find(entry => entry.id === 'a').matchesPlayed, 1);
  assert.equal(edited.find(entry => entry.id === 'a').participationBonus, 5);
  assert.notEqual(original.find(entry => entry.id === 'a').points, edited.find(entry => entry.id === 'a').points);
});

test('social player counts distinct partners across completed matches', () => {
  const ranking = calculateRanking(
    [
      { id: 'a', start: 1000 },
      { id: 'b', start: 1000 },
      { id: 'c', start: 1000 },
      { id: 'd', start: 1000 },
      { id: 'e', start: 1000 },
      { id: 'f', start: 1000 },
    ],
    [
      { team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-05-01T10:00:00.000Z' },
      { team1: ['a', 'c'], team2: ['b', 'e'], score1: 6, score2: 3, completedAt: '2026-05-03T10:00:00.000Z' },
      { team1: ['a', 'f'], team2: ['d', 'e'], score1: 3, score2: 6, completedAt: '2026-05-06T10:00:00.000Z' },
    ],
  );

  assert.equal(ranking.find(entry => entry.id === 'a').distinctPartners, 3);
});

test('master qualification keeps only the top 16 players with at least 6 matches', () => {
  const ranking = Array.from({ length: 18 }).map((_, index) => ({
    id: `p${index + 1}`,
    points: 2000 - index,
    wins: 10,
    matchesPlayed: index === 16 ? 5 : 6,
    eligibleForMaster: index === 16 ? false : true,
  }));
  const qualifiedIds = ranking.filter(entry => entry.eligibleForMaster).slice(0, MASTER_SIZE).map(entry => entry.id);

  assert.equal(qualifiedIds.length, 16);
  assert.ok(!qualifiedIds.includes('p17'));
  assert.deepEqual(qualifiedIds[0], 'p1');
  assert.deepEqual(qualifiedIds[15], 'p16');
});
