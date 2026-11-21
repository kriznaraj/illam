import type { SupabaseClient } from '@supabase/supabase-js';
import type { Note } from '@/types';
import { BaseService } from './BaseService';
import { NoteRepository } from '@/lib/repositories/NoteRepository';

export class NoteService extends BaseService {
  private noteRepo: NoteRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.noteRepo = new NoteRepository(supabase);
  }

  async list(filters: { archived: boolean; search?: string; tag?: string }): Promise<Note[]> {
    try {
      return await this.noteRepo.findForList(filters);
    } catch (error) {
      this.handleError(error, 'list notes');
    }
  }

  async create(data: { title: string; content?: string | null; tags?: string[]; is_pinned?: boolean }): Promise<Note> {
    try {
      if (!data.title || data.title.trim().length === 0) {
        throw new Error('Title is required');
      }

      return await this.noteRepo.create({
        user_id: null,
        title: data.title.trim(),
        content: data.content ?? null,
        tags: data.tags ?? [],
        is_pinned: data.is_pinned ?? false,
        is_archived: false,
      } as any);
    } catch (error) {
      this.handleError(error, 'create note');
    }
  }

  async update(
    id: string,
    patch: Partial<{ title: string; content: string | null; tags: string[]; is_pinned: boolean; is_archived: boolean }>
  ): Promise<Note> {
    try {
      this.validateUUID(id, 'Note ID');
      const updates: Record<string, unknown> = {};
      if (patch.title !== undefined) updates.title = patch.title.trim();
      if (patch.content !== undefined) updates.content = patch.content;
      if (patch.tags !== undefined) updates.tags = patch.tags;
      if (patch.is_pinned !== undefined) updates.is_pinned = patch.is_pinned;
      if (patch.is_archived !== undefined) updates.is_archived = patch.is_archived;

      return await this.noteRepo.update(id, updates as any);
    } catch (error) {
      this.handleError(error, 'update note');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Note ID');
      await this.noteRepo.delete(id);
    } catch (error) {
      this.handleError(error, 'delete note');
    }
  }
}

