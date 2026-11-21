import { BaseService } from './BaseService';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { User } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * User Service
 * Handles all business logic for users
 */
export class UserService extends BaseService {
  private userRepo: UserRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.userRepo = new UserRepository(supabase);
  }

  async getAllUsers(): Promise<User[]> {
    try {
      return await this.userRepo.findAll();
    } catch (error) {
      this.handleError(error, 'get all users');
    }
  }

  async getActiveUsersSorted(): Promise<User[]> {
    try {
      return await this.userRepo.findActiveSorted();
    } catch (error) {
      this.handleError(error, 'get active users sorted');
    }
  }

  async getActiveUserById(id: string): Promise<User | null> {
    try {
      this.validateUUID(id, 'User ID');
      return await this.userRepo.findActiveById(id);
    } catch (error) {
      this.handleError(error, 'get active user by ID');
    }
  }

  async getUserById(id: string): Promise<User | null> {
    try {
      this.validateUUID(id, 'User ID');
      return await this.userRepo.findById(id);
    } catch (error) {
      this.handleError(error, 'get user by ID');
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      if (!email) {
        throw new Error('Email is required');
      }

      return await this.userRepo.findByEmail(email);
    } catch (error) {
      this.handleError(error, 'get user by email');
    }
  }

  async getUserByUsername(username: string): Promise<User | null> {
    try {
      if (!username) {
        throw new Error('Username is required');
      }

      return await this.userRepo.findByUsername(username);
    } catch (error) {
      this.handleError(error, 'get user by username');
    }
  }

  async searchUsers(searchTerm: string, limit: number = 10): Promise<User[]> {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        throw new Error('Search term is required');
      }

      return await this.userRepo.search(searchTerm, limit);
    } catch (error) {
      this.handleError(error, 'search users');
    }
  }

  async getActiveUsers(): Promise<User[]> {
    try {
      return await this.userRepo.getActiveUsers();
    } catch (error) {
      this.handleError(error, 'get active users');
    }
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    try {
      this.validateUUID(id, 'User ID');

      // Validate email if being updated
      if (data.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
          throw new Error('Invalid email format');
        }

        // Check if email is already taken by another user
        const existingUser = await this.userRepo.findByEmail(data.email);
        if (existingUser && existingUser.id !== id) {
          throw new Error('Email is already taken');
        }
      }

      // Validate username if being updated
      if (data.username) {
        const existingUser = await this.userRepo.findByUsername(data.username);
        if (existingUser && existingUser.id !== id) {
          throw new Error('Username is already taken');
        }
      }

      return await this.userRepo.update(id, data);
    } catch (error) {
      this.handleError(error, 'update user');
    }
  }
}
