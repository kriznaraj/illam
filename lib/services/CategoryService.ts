import { BaseService } from './BaseService';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { Category } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Category Service
 * Handles all business logic for categories
 */
export class CategoryService extends BaseService {
  private categoryRepo: CategoryRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.categoryRepo = new CategoryRepository(supabase);
  }

  async getAllCategories(): Promise<Category[]> {
    try {
      return await this.categoryRepo.findAllSorted();
    } catch (error) {
      this.handleError(error, 'get all categories');
    }
  }

  async getCategoryById(id: string): Promise<Category | null> {
    try {
      this.validateUUID(id, 'Category ID');
      return await this.categoryRepo.findById(id);
    } catch (error) {
      this.handleError(error, 'get category by ID');
    }
  }

  async getCategoriesByGroup(groupName: string): Promise<Category[]> {
    try {
      if (!groupName) {
        throw new Error('Group name is required');
      }
      return await this.categoryRepo.findByGroup(groupName);
    } catch (error) {
      this.handleError(error, 'get categories by group');
    }
  }

  async createCategory(data: Partial<Category>): Promise<Category> {
    try {
      this.validateRequired(data, ['name', 'group_name', 'color']);

      // Check if category name already exists
      const existing = await this.categoryRepo.findByName(data.name!);
      if (existing) {
        throw new Error(`Category with name "${data.name}" already exists`);
      }

      return await this.categoryRepo.create(data);
    } catch (error) {
      this.handleError(error, 'create category');
    }
  }

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    try {
      this.validateUUID(id, 'Category ID');

      // If updating name, check for duplicates
      if (data.name) {
        const existing = await this.categoryRepo.findByName(data.name);
        if (existing && existing.id !== id) {
          throw new Error(`Category with name "${data.name}" already exists`);
        }
      }

      return await this.categoryRepo.update(id, data);
    } catch (error) {
      this.handleError(error, 'update category');
    }
  }

  async deleteCategory(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Category ID');
      const existing = await this.categoryRepo.findById(id);
      if (!existing) {
        throw new Error('Category not found');
      }

      await this.categoryRepo.delete(id);

      const afterDelete = await this.categoryRepo.findById(id);
      if (afterDelete) {
        throw new Error('Category deletion failed');
      }
    } catch (error) {
      this.handleError(error, 'delete category');
    }
  }

  async reorderCategories(categoryIds: string[]): Promise<void> {
    try {
      if (!categoryIds || categoryIds.length === 0) {
        throw new Error('Category IDs are required');
      }

      categoryIds.forEach((id) => this.validateUUID(id, 'Category ID'));

      await Promise.all(
        categoryIds.map((id, index) => this.categoryRepo.updateSortOrder(id, index))
      );

      this.log('reorderCategories', 'Categories reordered', {
        count: categoryIds.length,
      });
    } catch (error) {
      this.handleError(error, 'reorder categories');
    }
  }

  async getUniqueGroups(): Promise<string[]> {
    try {
      return await this.categoryRepo.getUniqueGroups();
    } catch (error) {
      this.handleError(error, 'get unique groups');
    }
  }
}
