import { BaseService } from './BaseService';
import { TagRepository } from '@/lib/repositories/TagRepository';
import { Tag } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeTagName } from '@/lib/utils/validation';

/**
 * Tag Service
 * Handles all business logic for tags
 */
export class TagService extends BaseService {
  private tagRepo: TagRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.tagRepo = new TagRepository(supabase);
  }

  async getTagByName(name: string): Promise<Tag | null> {
    try {
      if (!name || name.trim().length === 0) return null;
      const sanitizedName = sanitizeTagName(name);
      if (!sanitizedName) return null;
      return await this.tagRepo.findByName(sanitizedName);
    } catch (error) {
      this.handleError(error, 'get tag by name');
    }
  }

  async getAllTags(): Promise<Tag[]> {
    try {
      return await this.tagRepo.findAllSorted();
    } catch (error) {
      this.handleError(error, 'get all tags');
    }
  }

  async getTagsForUser(userId: string): Promise<Tag[]> {
    try {
      this.validateUUID(userId, 'User ID');
      return await this.tagRepo.findForUser(userId);
    } catch (error) {
      this.handleError(error, 'get tags for user');
    }
  }

  async createTag(data: Partial<Tag>): Promise<Tag> {
    try {
      this.validateRequired(data, ['name']);

      // Sanitize tag name
      const sanitizedName = sanitizeTagName(data.name!);
      if (!sanitizedName) {
        throw new Error('Tag name is invalid after sanitization');
      }

      // Family-wide semantics: dedupe by name only.
      const existing = await this.tagRepo.findByName(sanitizedName);
      if (existing) {
        // Return existing tag instead of throwing error
        return existing;
      }

      // Create tag with sanitized name
      const tagData = {
        ...data,
        name: sanitizedName,
        // Keep legacy columns but stop using them for visibility.
        is_shared: true,
        user_id: null,
        color: data.color || '#6b7280',
      };

      return await this.tagRepo.create(tagData);
    } catch (error) {
      this.handleError(error, 'create tag');
    }
  }

  async updateTag(id: string, data: Partial<Tag>): Promise<Tag> {
    try {
      this.validateUUID(id, 'Tag ID');

      // If updating name, sanitize it
      if (data.name) {
        data.name = sanitizeTagName(data.name);
        if (!data.name) {
          throw new Error('Tag name is invalid after sanitization');
        }

        // Check for duplicates
        const existing = await this.tagRepo.findByName(data.name);
        if (existing && existing.id !== id) {
          throw new Error(`Tag with name "${data.name}" already exists`);
        }
      }

      return await this.tagRepo.update(id, data);
    } catch (error) {
      this.handleError(error, 'update tag');
    }
  }

  async deleteTag(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Tag ID');
      // expense_tags rows go with it (ON DELETE CASCADE).
      await this.tagRepo.delete(id);
    } catch (error) {
      this.handleError(error, 'delete tag');
    }
  }

  /**
   * Find or create tag by name
   * Useful for auto-creating tags when user types them
   */
  async findOrCreateTag(name: string, userId?: string): Promise<Tag> {
    try {
      const sanitizedName = sanitizeTagName(name);
      if (!sanitizedName) {
        throw new Error('Tag name is invalid after sanitization');
      }

      // Try to find existing tag
      let tag = await this.tagRepo.findByName(sanitizedName);

      if (!tag) {
        // Create new tag
        tag = await this.tagRepo.create({
          name: sanitizedName,
          color: this.generateRandomColor(),
          is_shared: true,
          user_id: null,
        });

        this.log('findOrCreateTag', 'Created new tag', { name: sanitizedName });
      }

      return tag;
    } catch (error) {
      this.handleError(error, 'find or create tag');
    }
  }

  /**
   * Generate random color for tag
   */
  private generateRandomColor(): string {
    const colors = [
      '#3b82f6', // blue
      '#10b981', // green
      '#f59e0b', // yellow
      '#ef4444', // red
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#f97316', // orange
    ];

    return colors[Math.floor(Math.random() * colors.length)];
  }
}
