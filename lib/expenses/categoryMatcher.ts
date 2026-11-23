/**
 * Offline keyword → category matcher.
 *
 * This is the fallback for AI categorization and the instant local guess in
 * QuickAddExpense, so it must work standalone with no network and no API key.
 *
 * Keywords map directly to canonical category names, so renaming a category breaks
 * loudly (see the test) rather than silently.
 *
 * Keywords are matched on word boundaries and the LONGEST match wins, so a specific
 * phrase beats a generic word: 'entry ticket' → Recreation, bare 'ticket' → Commute.
 */

/** Canonical category name → keywords that imply it. Names must match the DB exactly. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Groceries & Staples': [
    'grocery', 'groceries', 'kirana', 'provisions', 'supermarket', 'market',
    'vegetable', 'vegetables', 'veggies', 'fruit', 'fruits', 'greens',
    'rice', 'dal', 'atta', 'flour', 'sugar', 'salt', 'oil packet',
    'milk', 'curd', 'egg', 'eggs', 'meat', 'chicken', 'mutton', 'fish',
    'dmart', 'd mart', 'big bazaar', 'reliance fresh', 'nilgiris',
  ],
  'Mobile & Broadband': [
    'mobile recharge', 'recharge', 'airtel', 'jio', 'vodafone', 'bsnl',
    'broadband', 'wifi', 'internet', 'data pack', 'postpaid', 'prepaid',
    'act fibernet', 'hathway', 'sim',
  ],
  'Electricity': ['electricity', 'current bill', 'power bill', 'tneb', 'eb bill', 'electric bill'],
  'Cooking Gas': ['gas cylinder', 'cylinder', 'lpg', 'indane', 'bharat gas', 'hp gas', 'cooking gas'],
  'Home Maintenance': [
    'plumber', 'electrician', 'carpenter', 'pest control', 'watchman',
    'society maintenance', 'common maintenance', 'house cleaning', 'maid', 'servant',
    'water tanker', 'borewell', 'cleaning', 'chimney', 'amc',
  ],
  'Fuel': ['petrol', 'diesel', 'fuel', 'petrol bunk', 'bunk', 'indian oil', 'shell'],
  'Vehicle Maintenance': [
    'bike service', 'car service', 'vehicle service', 'servicing', 'puncture',
    'tyre', 'tire', 'oil change', 'mechanic', 'fastag', 'car wash', 'bike wash',
  ],
  'Education': [
    'school', 'school fee', 'tuition', 'college', 'course', 'exam fee',
    'notebook', 'stationery', 'text book', 'van fee', 'hostel',
  ],
  'Healthcare': [
    'doctor', 'medicine', 'medicines', 'tablet', 'tablets', 'hospital', 'clinic',
    'pharmacy', 'medical', 'lab test', 'scan', 'consultation', 'dentist',
    'vaccine', 'supplements', 'physio',
  ],
  'Commute & Travel': [
    'bus', 'train', 'auto', 'cab', 'uber', 'ola', 'rapido', 'metro', 'share auto',
    'ticket', 'travel', 'flight', 'toll', 'parking', 'irctc',
  ],
  'Dining Out': [
    'restaurant', 'hotel', 'dinner', 'lunch', 'breakfast', 'swiggy', 'zomato',
    'biryani', 'meals', 'dosa', 'buffet', 'dine', 'food order', 'parcel',
  ],
  'Quick bites': [
    'tea', 'coffee', 'snack', 'snacks', 'bajji', 'bonda', 'vada', 'samosa',
    'pani poori', 'panipuri', 'pani puri', 'chaat', 'ice cream', 'juice',
    'bakery', 'puffs', 'cool drinks', 'soda', 'biscuit',
    'water bottle', 'tender coconut', 'coconut water', 'butter milk', 'lassi',
  ],
  'Recreation': [
    'movie', 'cinema', 'theatre', 'pvr', 'inox', 'entry ticket', 'game', 'games',
    'park', 'zoo', 'beach', 'outing', 'picnic', 'concert', 'amusement',
    'dance class', 'sports', 'gym',
  ],
  'Grooming & Personal Care': [
    'saloon', 'salon', 'haircut', 'hair cut', 'parlour', 'parlor', 'shampoo',
    'soap', 'cosmetics', 'facial', 'spa', 'grooming', 'shaving', 'skin care',
  ],
  'Online Shopping': [
    'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'online order',
    'dress', 'clothes', 'shirt', 'saree', 'footwear', 'shoes', 'chappal', 'bag',
  ],
  'Subscriptions': [
    'netflix', 'prime', 'hotstar', 'spotify', 'youtube premium', 'subscription',
    'sun nxt', 'zee5', 'sony liv', 'icloud', 'google one', 'membership',
    'domain', 'hosting',
  ],
  'Kids & Toys': ['toy', 'toys', 'kids', 'baby', 'diaper', 'diapers', 'doll', 'cycle'],
  'Temple & Pooja': [
    'temple', 'pooja', 'puja', 'kovil', 'koil', 'archanai', 'prasadam',
    'annadhanam', 'donation', 'hundial', 'abhishekam', 'vratham', 'homam',
    'flower', 'flowers', 'maalai', 'malai', 'garland', 'kumkum', 'camphor', 'agarbathi',
  ],
  'Home Improvement (One-time)': [
    'furniture', 'paint', 'painting', 'renovation', 'interior', 'tiles',
    'wardrobe', 'sofa', 'cot', 'mattress', 'fridge', 'washing machine',
    'air conditioner', 'grinder', 'mixie',
  ],
  'Gold & Jewelry (One-time)': [
    'gold', 'jewel', 'jewellery', 'jewelry', 'silver', 'chain', 'bangle',
    'thali', 'gold coin', 'lalitha', 'joyalukkas', 'tanishq', 'grt',
  ],
  'Gifts (One-time)': ['gift', 'gifts', 'present for', 'moi', 'seer', 'birthday gift', 'wedding gift'],
  'Property Tax (One-time)': ['property tax', 'house tax', 'land tax', 'patta', 'registration fee'],

  // 'Miscellaneous' is deliberately absent — it is the bucket things land in when
  // nothing matches, so giving it keywords would defeat the point.
};

type MatchableCategory = { id: string; name: string };

export type KeywordMatch = {
  categoryId: string;
  categoryName: string;
  /** The keyword that matched — useful for debugging and for explaining the suggestion. */
  keyword: string;
};

const boundaryCache = new Map<string, RegExp>();

function keywordRegex(keyword: string): RegExp {
  let re = boundaryCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b around the whole phrase: 'gas' must not match 'gasket', 'bus' must not match 'business'.
    re = new RegExp(`\\b${escaped}\\b`, 'i');
    boundaryCache.set(keyword, re);
  }
  return re;
}

/**
 * Suggest a category from a free-text description using local keywords only.
 * Returns null when nothing matches — callers should leave the field empty rather
 * than defaulting to Miscellaneous, so that genuinely unclassifiable spend stays visible.
 */
export function matchCategoryByKeyword(
  description: string,
  categories: MatchableCategory[],
): KeywordMatch | null {
  if (!description || description.trim().length < 3 || categories.length === 0) return null;

  const desc = description.toLowerCase();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  let best: KeywordMatch | null = null;
  let bestLength = 0;

  // Direct mention of the category name always counts, and outranks keywords of equal length.
  for (const cat of categories) {
    const name = cat.name.toLowerCase();
    if (name.length >= 4 && keywordRegex(name).test(desc) && name.length > bestLength) {
      best = { categoryId: cat.id, categoryName: cat.name, keyword: cat.name };
      bestLength = name.length;
    }
  }

  for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const cat = byName.get(categoryName.toLowerCase());
    if (!cat) continue; // category not present in this DB — skip rather than guess
    for (const keyword of keywords) {
      if (keyword.length > bestLength && keywordRegex(keyword).test(desc)) {
        best = { categoryId: cat.id, categoryName: cat.name, keyword };
        bestLength = keyword.length;
      }
    }
  }

  return best;
}

/** Canonical names this matcher knows about — used by the test to catch DB drift. */
export function knownCategoryNames(): string[] {
  return Object.keys(CATEGORY_KEYWORDS);
}
