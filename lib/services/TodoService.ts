import type { SupabaseClient } from '@supabase/supabase-js';
import type { Todo } from '@/types';
import { BaseService } from './BaseService';
import { TodoRepository } from '@/lib/repositories/TodoRepository';

export class TodoService extends BaseService {
  private todoRepo: TodoRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.todoRepo = new TodoRepository(supabase);
  }

  async list(filters: { status?: string; priority?: string }): Promise<Todo[]> {
    try {
      return await this.todoRepo.findForList(filters);
    } catch (error) {
      this.handleError(error, 'list todos');
    }
  }

  async create(data: {
    user_id?: string | null;
    title: string;
    description?: string | null;
    status?: Todo['status'];
    priority?: Todo['priority'];
    due_date?: string | null;
  }): Promise<Todo> {
    try {
      if (!data.title || data.title.trim().length === 0) {
        throw new Error('Title is required');
      }

      return await this.todoRepo.create({
        user_id: data.user_id ?? null,
        title: data.title.trim(),
        description: data.description ?? null,
        status: data.status ?? 'pending',
        priority: data.priority ?? 'medium',
        due_date: data.due_date ?? null,
        completed_at: (data.status ?? 'pending') === 'completed' ? new Date().toISOString() : null,
      });
    } catch (error) {
      this.handleError(error, 'create todo');
    }
  }

  async update(
    id: string,
    patch: Partial<{
      title: string;
      description: string | null;
      status: Todo['status'];
      priority: Todo['priority'];
      due_date: string | null;
      user_id: string | null;
    }>
  ): Promise<Todo> {
    try {
      this.validateUUID(id, 'Todo ID');
      const updates: Partial<Todo> = {};
      if (patch.title !== undefined) updates.title = patch.title.trim();
      if (patch.description !== undefined) updates.description = patch.description;
      if (patch.priority !== undefined) updates.priority = patch.priority;
      if (patch.due_date !== undefined) updates.due_date = patch.due_date;
      if (patch.user_id !== undefined) updates.user_id = patch.user_id;
      if (patch.status !== undefined) {
        updates.status = patch.status;
        updates.completed_at = patch.status === 'completed' ? new Date().toISOString() : null;
      }

      return await this.todoRepo.update(id, updates);
    } catch (error) {
      this.handleError(error, 'update todo');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Todo ID');
      await this.todoRepo.delete(id);
    } catch (error) {
      this.handleError(error, 'delete todo');
    }
  }
}

