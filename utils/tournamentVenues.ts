import { type TimeSlot } from '../types';

export const TOURNAMENT_VENUES = [
  { id: 'canottieri-salo', name: 'Canottieri Salò', phone: '+393397957909', bookingProvider: 'Playtomic', bookingUrl: 'https://playtomic.com/it/clubs/tennis-salo-canottieri' },
  { id: 'paitone-arena', name: 'Paitone Arena', phone: '+393896556476', bookingProvider: 'Wansport', bookingUrl: 'https://paitonearena.wansport.com/' },
] as const;

export type TournamentVenueId = typeof TOURNAMENT_VENUES[number]['id'];

export function getSlotVenueId(slot: Pick<TimeSlot, 'venueId' | 'location'>): TournamentVenueId | undefined {
  if (TOURNAMENT_VENUES.some(venue => venue.id === slot.venueId)) return slot.venueId;
  const location = slot.location.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (location.includes('canottieri') || location.includes('salo')) return 'canottieri-salo';
  if (location.includes('paitone')) return 'paitone-arena';
  return undefined;
}

export const formatTournamentSlotDate = (start: string) =>
  new Date(start).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatTournamentSlotTime = (start: string) =>
  new Date(start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
