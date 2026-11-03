import { type Player, type User } from '../types';

export const DEFAULT_PLAYER_PASSWORD = '1234';

export const normalizeLoginName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');

export function findLoginUser(users: User[], players: Player[], name: string, password: string): User | null {
  const normalizedName = normalizeLoginName(name);
  if (!normalizedName) return null;
  const usernameMatches = users.filter(user => normalizeLoginName(user.username) === normalizedName);
  // An explicit username takes precedence over a player's full-name alias.
  if (usernameMatches.length) {
    return usernameMatches.length === 1 && usernameMatches[0].password === password ? usernameMatches[0] : null;
  }
  const playerIds = new Set(players.filter(player => normalizeLoginName(player.name) === normalizedName).map(player => player.id));
  if (playerIds.size !== 1) return null;
  const matches = users.filter(user => user.role === 'participant' && playerIds.has(user.playerId));
  return matches.length === 1 && matches[0].password === password ? matches[0] : null;
}
