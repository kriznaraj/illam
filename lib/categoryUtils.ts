import { Category } from '@/types';

// Fallback icons, used only when a category row has no `icon` of its own.
// Keyed on the canonical category names seeded by db/migrations.
const categoryIconMap: { [key: string]: string } = {
  // Need
  'Groceries & Staples': '🛒',
  'Mobile & Broadband': '📱',
  'Electricity': '⚡',
  'Cooking Gas': '🔥',
  'Home Maintenance': '🏠',
  'Fuel': '⛽',
  'Vehicle Maintenance': '🚗',
  'Education': '🎒',
  'Healthcare': '💊',
  'Commute & Travel': '🚌',

  // Want
  'Dining Out': '🍽️',
  'Quick bites': '🍿',
  'Recreation': '🎉',
  'Grooming & Personal Care': '💇',
  'Online Shopping': '📦',
  'Subscriptions': '🎧',
  'Kids & Toys': '🧸',
  'Temple & Pooja': '🛕',

  // One-time
  'Home Improvement (One-time)': '🛠️',
  'Gold & Jewelry (One-time)': '💎',
  'Gifts (One-time)': '🎁',
  'Property Tax (One-time)': '🏛️',

  // Unplanned
  'Miscellaneous': '📌',

  // Common names for user-created categories.
  'Common Maintenance': '🔧', 'EB': '⚡', 'Home improvements': '🏠', 'Property Tax': '🏛️',
  'Car Petrol': '⛽', 'Car Maintenance': '🚗', 'Bike Petrol': '🏍️', 'Bus/Cab': '🚌',
  'Two Wheeler Maintenance': '🔧', 'Gas': '🔥', 'Milk': '🥛', 'Egg': '🥚', 'Rice': '🍚',
  'Groceries': '🛒', 'Vegetables': '🥬', 'Fruits': '🍎', 'Meat': '🍖', 'Fish': '🐟',
  'Restaurants': '🍽️', 'Local Hotel': '🏨', 'Small Eats': '🍿', 'School': '🎒',
  'Van Fee': '🚐', 'Toys': '🧸', 'Dance class': '💃', 'Sports': '⚽', 'EComm': '📦',
  'Pooja': '🕉️', 'Jewel': '💎', 'Dress': '👗', 'Fancy': '✨', 'Cinemas': '🎬',
  'Hotels': '🏨', 'Temple': '🛕', 'Other Recreation': '🎡', 'Broadband': '📡',
  'Digital Subscriptions': '📱', 'Mobiles': '📞', 'Doctor': '👨‍⚕️', 'Medical': '💊',
  'Lab': '🔬', 'Supplements': '💪', 'Saloon': '💇', 'Skin & Hair care': '🧴', 'Other': '📎',
};

// Group-level fallback. The seeded groups are Need | Want | One-time | Unplanned.
const groupIconMap: { [key: string]: string } = {
  'Need': '🏠',
  'Want': '🛍️',
  'One-time': '📦',
  'Unplanned': '📌',

  // Other common group names.
  'House': '🏠', 'Transport': '🚗', 'Food': '🍽️', 'Eat out': '🍴',
  'Shopping': '🛍️', 'Outing': '🎉', 'Mobile & Internet': '📱', 'Health': '⚕️',
  'Grooming': '💅', 'Miscl': '📌',
};

/**
 * Get category icon with intelligent fallback
 */
export function getCategoryIcon(category: Pick<Category, 'name' | 'icon' | 'group_name'> | { name: string; icon?: string; group_name?: string } | undefined | null): string {
  if (!category) return '📝';

  // If category has an icon, use it
  if ('icon' in category && category.icon) return category.icon;

  // Try exact match on category name
  if (categoryIconMap[category.name]) {
    return categoryIconMap[category.name];
  }

  // Try partial match on category name. Only one direction (name contains key) and only
  // for keys of 4+ chars, so a short name like 'EB' or 'Gas' does not match any key that
  // happens to contain those letters.
  const categoryNameLower = category.name.toLowerCase();
  for (const [key, icon] of Object.entries(categoryIconMap)) {
    const k = key.toLowerCase();
    if (k.length >= 4 && categoryNameLower.includes(k)) {
      return icon;
    }
  }

  // Fall back to group icon
  if (category.group_name && groupIconMap[category.group_name]) {
    return groupIconMap[category.group_name];
  }

  // Ultimate fallback
  return '📝';
}
