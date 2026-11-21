import { describe, it, expect } from 'vitest';
import { getCategoryIcon, getCategoryDisplay } from '../categoryUtils';
import type { Category } from '@/types';

describe('Category Utilities', () => {
  describe('getCategoryIcon', () => {
    it('should return icon from category object if present', () => {
      const category = { name: 'Food', icon: '🍕', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🍕');
    });

    it('should return default icon for null category', () => {
      expect(getCategoryIcon(null)).toBe('📝');
    });

    it('should return default icon for undefined category', () => {
      expect(getCategoryIcon(undefined)).toBe('📝');
    });

    it('should return mapped icon for known category name - Gas', () => {
      const category = { name: 'Gas', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🔥');
    });

    it('should return mapped icon for known category name - Groceries', () => {
      const category = { name: 'Groceries', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🛒');
    });

    it('should return mapped icon for known category name - Car Petrol', () => {
      const category = { name: 'Car Petrol', group_name: 'Transport' } as Category;
      expect(getCategoryIcon(category)).toBe('⛽');
    });

    it('should return mapped icon for known category name - School', () => {
      const category = { name: 'School', group_name: 'Carol' } as Category;
      expect(getCategoryIcon(category)).toBe('🎒');
    });

    it('should return mapped icon for known category name - Doctor', () => {
      const category = { name: 'Doctor', group_name: 'Health' } as Category;
      expect(getCategoryIcon(category)).toBe('👨‍⚕️');
    });

    it('should return group icon as fallback', () => {
      const category = { name: 'Unknown Category', group_name: 'Transport' } as Category;
      expect(getCategoryIcon(category)).toBe('🚗');
    });

    it('should return default icon for unknown category and group', () => {
      const category = { name: 'Unknown', group_name: 'Unknown' } as Category;
      expect(getCategoryIcon(category)).toBe('📝');
    });

    it('should handle partial category object from Supabase query', () => {
      const partialCategory = { name: 'Groceries' };
      expect(getCategoryIcon(partialCategory as any)).toBe('🛒');
    });

    it('should handle category without icon property', () => {
      const category = { name: 'Milk', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🥛');
    });

    it('should handle partial match on category name', () => {
      const category = { name: 'car', group_name: 'Transport' } as Category;
      // Should match "Car Petrol" or "Car Maintenance" (case insensitive)
      expect(['⛽', '🚗']).toContain(getCategoryIcon(category));
    });

    it('should handle case-insensitive matching', () => {
      const category = { name: 'GROCERIES', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🛒');
    });
  });

  describe('getCategoryDisplay', () => {
    it('should return icon and name for valid category', () => {
      const category = { name: 'Gas', icon: '🔥', group_name: 'Food' } as Category;
      expect(getCategoryDisplay(category)).toBe('🔥 Gas');
    });

    it('should return only icon when iconOnly is true', () => {
      const category = { name: 'Gas', icon: '🔥', group_name: 'Food' } as Category;
      expect(getCategoryDisplay(category, true)).toBe('🔥');
    });

    it('should return default icon for null category', () => {
      expect(getCategoryDisplay(null)).toBe('📝');
    });

    it('should return default icon for undefined category', () => {
      expect(getCategoryDisplay(undefined)).toBe('📝');
    });

    it('should handle category without custom icon', () => {
      const category = { name: 'Groceries', group_name: 'Food' } as Category;
      expect(getCategoryDisplay(category)).toBe('🛒 Groceries');
    });

    it('should use mapped icon when category has no icon property', () => {
      const category = { name: 'Gas', group_name: 'Food' } as Category;
      expect(getCategoryDisplay(category)).toBe('🔥 Gas');
    });
  });

  describe('Real-World Category Scenarios', () => {
    it('should handle Gas cylinder refill expense', () => {
      const category = { name: 'Gas', group_name: 'Food' } as Category;
      expect(getCategoryIcon(category)).toBe('🔥');
      expect(getCategoryDisplay(category)).toBe('🔥 Gas');
    });

    it('should handle Car petrol expense', () => {
      const category = { name: 'Car Petrol', group_name: 'Transport' } as Category;
      expect(getCategoryIcon(category)).toBe('⛽');
      expect(getCategoryDisplay(category)).toBe('⛽ Car Petrol');
    });

    it('should handle School fee expense', () => {
      const category = { name: 'School', group_name: 'Carol' } as Category;
      expect(getCategoryIcon(category)).toBe('🎒');
      expect(getCategoryDisplay(category)).toBe('🎒 School');
    });

    it('should handle Doctor visit expense', () => {
      const category = { name: 'Doctor', group_name: 'Health' } as Category;
      expect(getCategoryIcon(category)).toBe('👨‍⚕️');
      expect(getCategoryDisplay(category)).toBe('👨‍⚕️ Doctor');
    });

    it('should handle Electric bill expense', () => {
      const category = { name: 'EB', group_name: 'House' } as Category;
      expect(getCategoryIcon(category)).toBe('⚡');
      expect(getCategoryDisplay(category)).toBe('⚡ EB');
    });

    it('should handle Restaurant expense', () => {
      const category = { name: 'Restaurants', group_name: 'Eat out' } as Category;
      expect(getCategoryIcon(category)).toBe('🍽️');
      expect(getCategoryDisplay(category)).toBe('🍽️ Restaurants');
    });

    it('should handle Broadband bill expense', () => {
      const category = { name: 'Broadband', group_name: 'Mobile & Internet' } as Category;
      expect(getCategoryIcon(category)).toBe('📡');
      expect(getCategoryDisplay(category)).toBe('📡 Broadband');
    });

    it('should handle category from Supabase expense query', () => {
      // Simulates partial category from joined query
      const partialCategory = { name: 'Groceries', group_name: 'Food' };
      expect(getCategoryIcon(partialCategory as any)).toBe('🛒');
      expect(getCategoryDisplay(partialCategory as any)).toBe('🛒 Groceries');
    });

    it('should handle missing category gracefully in expense list', () => {
      expect(getCategoryIcon(null)).toBe('📝');
      expect(getCategoryDisplay(null)).toBe('📝');
    });

    it('should display icon-only in compact mobile view', () => {
      const category = { name: 'Gas', group_name: 'Food' } as Category;
      expect(getCategoryDisplay(category, true)).toBe('🔥');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle category with only name', () => {
      const minimal = { name: 'Test' };
      expect(getCategoryIcon(minimal as any)).toBe('📝');
      expect(getCategoryDisplay(minimal as any)).toBe('📝 Test');
    });

    it('should handle category with null values', () => {
      const withNulls = {
        name: 'Test',
        icon: null as any,
        group_name: null as any,
      };
      expect(() => getCategoryIcon(withNulls as any)).not.toThrow();
      expect(getCategoryIcon(withNulls as any)).toBe('📝');
    });

    it('should handle category with empty icon string', () => {
      const emptyIcon = {
        name: 'Gas',
        icon: '',
        group_name: 'Food',
      };
      // Empty icon should fall back to mapped icon
      expect(getCategoryIcon(emptyIcon as any)).toBe('🔥');
    });

    it('should handle category with empty name string', () => {
      const emptyName = {
        name: '',
        icon: '',
        group_name: '',
      };
      // Empty name matches all strings in partial matching, returns first icon in map
      // This is current behavior - empty string is included in all strings
      const result = getCategoryIcon(emptyName as any);
      expect(result).toBeTruthy(); // Should get some icon
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
