import { Calendar, Gamepad2, MapPin, Utensils } from 'lucide-solid';
import type { EventCategory } from '@/models/schedule';

export const EVENT_CATEGORIES: { id: EventCategory; label: string; icon: typeof Gamepad2 }[] = [
  { id: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { id: 'food', label: 'Food & Drinks', icon: Utensils },
  { id: 'outdoor', label: 'Outside / POI', icon: MapPin },
  { id: 'other', label: 'Other', icon: Calendar },
];

export function inferCategory(title?: string, description?: string): EventCategory {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (/\b(game|gaming|play|match|stream|lan|esport|rpg|mmo|fps|valorant|lol|dota|cs2|minecraft|roblox|genshin|raid)\b/.test(text)) {
    return 'gaming';
  }
  if (/\b(food|eat|lunch|dinner|breakfast|brunch|meal|pizza|burger|coffee|cafe|bar|bbq|cook|drink|restaurant|boba|snack)\b/.test(text)) {
    return 'food';
  }
  if (/\b(outdoor|park|walk|trip|hike|hiking|camp|camping|outside|beach|travel|tour|meetup|venue|location|poi)\b/.test(text)) {
    return 'outdoor';
  }
  return 'other';
}

export function getCategoryMeta(cat?: string, title?: string, description?: string) {
  let matched = EVENT_CATEGORIES.find((c) => c.id === cat);
  if ((!matched || matched.id === 'other') && (title || description)) {
    const inferred = inferCategory(title, description);
    if (inferred !== 'other') {
      matched = EVENT_CATEGORIES.find((c) => c.id === inferred);
    }
  }
  return matched || EVENT_CATEGORIES[3];
}
