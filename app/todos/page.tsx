'use client';

import { useState, useEffect } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { Todo, User } from '@/types';
import { format, isSameDay, parseISO, endOfWeek } from 'date-fns';
import { getTodayAppDate } from '@/lib/utils/dateUtils';

const PRIORITY_COLORS: Record<Todo['priority'], string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<Todo['status'], string> = {
  pending: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<Todo['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

type CreateDuePreset = 'today' | 'this_week' | 'eventually';

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [createDuePreset, setCreateDuePreset] = useState<CreateDuePreset>('eventually');
  const [showOptionalCreateFields, setShowOptionalCreateFields] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Todo['priority'],
    due_date: '',
    status: 'pending' as Todo['status'],
    user_id: '',
  });

  useEffect(() => {
    fetchTodos();
    fetchUsers();
  }, []);

  useEffect(() => {
    const handleCacheCleared = () => {
      fetchTodos();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, []);

  const fetchTodos = async () => {
    try {
      const res = await fetch('/api/todos');
      if (!res.ok) throw new Error('Failed to fetch todos');
      const data = await res.json();
      setTodos(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch todos:', error);
      setToast({ message: 'Failed to fetch todos', type: 'error' });
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const handleCreateTodo = () => {
    setSelectedTodo(null);
    setIsEditing(true);
    setShowDeleteConfirm(false);
    setCreateDuePreset('eventually');
    setShowOptionalCreateFields(false);
    setFormData({ title: '', description: '', priority: 'medium', due_date: '', status: 'pending', user_id: '' });
    setShowModal(true);
  };

  const handleViewTodo = (todo: Todo) => {
    setSelectedTodo(todo);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setShowModal(true);
  };

  const handleEditTodo = () => {
    if (!selectedTodo) return;
    setIsEditing(true);
    setShowDeleteConfirm(false);
    setFormData({
      title: selectedTodo.title,
      description: selectedTodo.description || '',
      priority: selectedTodo.priority,
      due_date: selectedTodo.due_date || '',
      status: selectedTodo.status,
      user_id: selectedTodo.user_id || '',
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setShowDeleteConfirm(false);
    setSelectedTodo(null);
    setIsEditing(false);
  };

  const handleSaveTodo = async () => {
    if (!formData.title.trim()) return;

    const buildDueDateFromPreset = (): string => {
      if (formData.due_date) return formData.due_date;
      if (createDuePreset === 'today') {
        return getTodayAppDate();
      }
      if (createDuePreset === 'this_week') {
        return format(endOfWeek(parseISO(getTodayAppDate()), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      }
      return '';
    };

    setIsSaving(true);
    try {
      if (selectedTodo) {
        const res = await fetch('/api/todos', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedTodo.id, ...formData }),
        });
        if (res.ok) {
          const updated = await res.json();
          setSelectedTodo(updated);
          setIsEditing(false);
          setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? updated : todo)));
          setToast({ message: 'Todo updated', type: 'success' });
        }
      } else {
        const createPayload = {
          ...formData,
          user_id: formData.user_id || null,
          due_date: buildDueDateFromPreset() || null,
          status: 'pending' as Todo['status'],
        };
        const res = await fetch('/api/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        });
        if (res.ok) {
          const created = await res.json();
          setTodos((prev) => [created, ...prev]);
          // Transition to view mode of the new task
          setSelectedTodo(created);
          setIsEditing(false);
          setToast({ message: 'Todo created', type: 'success' });
        }
      }
    } catch (error) {
      console.error('Failed to save todo:', error);
      setToast({ message: 'Failed to save todo', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkDone = async () => {
    if (!selectedTodo) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedTodo.id, status: 'completed' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedTodo(updated);
        setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? updated : todo)));
        setToast({ message: 'Marked as done', type: 'success' });
      }
    } catch (error) {
      console.error('Failed to mark done:', error);
      setToast({ message: 'Failed to update todo', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTodo = async () => {
    if (!selectedTodo) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/todos?id=${selectedTodo.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTodos((prev) => prev.filter((todo) => todo.id !== selectedTodo.id));
        handleCloseModal();
        setToast({ message: 'Todo deleted', type: 'success' });
      }
    } catch (error) {
      console.error('Failed to delete todo:', error);
      setToast({ message: 'Failed to delete todo', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickMarkDone = async (todo: Todo) => {
    if (todo.status === 'completed') return;
    try {
      const res = await fetch('/api/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: todo.id, status: 'completed' }),
      });

      if (!res.ok) return;
      const updated = await res.json();
      setTodos((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedTodo?.id === updated.id) setSelectedTodo(updated);
    } catch (error) {
      console.error('Failed to mark todo complete:', error);
    }
  };

  const handleRemoveDone = async () => {
    const doneTodos = todos.filter((todo) => todo.status === 'completed');
    if (doneTodos.length === 0) return;

    setIsSaving(true);
    try {
      const responses = await Promise.all(
        doneTodos.map((todo) => fetch(`/api/todos?id=${todo.id}`, { method: 'DELETE' }))
      );
      const failedCount = responses.filter((res) => !res.ok).length;
      const removedCount = doneTodos.length - failedCount;
      if (removedCount > 0) {
        setTodos((prev) => prev.filter((todo) => todo.status !== 'completed'));
      }
      if (failedCount > 0) {
        setToast({ message: `${failedCount} completed todo(s) failed to delete`, type: 'error' });
      } else {
        setToast({ message: 'Completed todos removed', type: 'info' });
      }
    } catch (error) {
      console.error('Failed to remove completed todos:', error);
      setToast({ message: 'Failed to remove completed todos', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const filteredTodos = todos.filter((todo) => {
    const matchesSearch =
      !searchQuery ||
      todo.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      todo.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCompletion = hideCompleted ? todo.status !== 'completed' : true;
    return matchesSearch && matchesCompletion;
  });

  const now = new Date();
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const userMap = users.reduce<Record<string, string>>((acc, user) => {
    acc[user.id] = user.full_name;
    return acc;
  }, {});

  const groupedTodos = filteredTodos.reduce(
    (groups, todo) => {
      if (!todo.due_date) {
        groups.eventually.push(todo);
        return groups;
      }

      const dueDate = parseISO(todo.due_date);
      if (isSameDay(dueDate, now)) {
        groups.today.push(todo);
      } else if (dueDate > now && dueDate <= weekEnd) {
        groups.this_week.push(todo);
      } else {
        groups.eventually.push(todo);
      }

      return groups;
    },
    { today: [] as Todo[], this_week: [] as Todo[], eventually: [] as Todo[] }
  );

  if (initialLoading) return <LoadingSpinner message="Loading tasks..." />;

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Seyal"
        description={format(new Date(), 'EEEE, MMM d')}
        action={
          <button onClick={handleCreateTodo} className="btn btn-primary">
            + Add Todo
          </button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Search todos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input sm:max-w-sm"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleRemoveDone}
            disabled={isSaving || todos.every((todo) => todo.status !== 'completed')}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Remove Done
          </button>
          <button onClick={() => setHideCompleted((prev) => !prev)} className="btn btn-ghost">
            {hideCompleted ? 'Show Done' : 'Hide Done'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { key: 'today', title: 'Today', items: groupedTodos.today },
          { key: 'this_week', title: 'This week', items: groupedTodos.this_week },
          { key: 'eventually', title: 'Eventually', items: groupedTodos.eventually },
        ].map((group) => (
          <section
            key={group.key}
            className="card p-4 min-h-[420px] border border-gray-200"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{group.title}</h2>
              <button onClick={handleCreateTodo} className="btn btn-ghost btn-sm text-lg leading-none">+</button>
            </div>

            <div className="space-y-2">
              {group.items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
                  No tasks
                </div>
              ) : (
                group.items.map((todo) => {
                  const isOverdue =
                    todo.due_date &&
                    new Date(`${todo.due_date}T23:59:59`) < new Date() &&
                    todo.status !== 'completed';

                  return (
                    <div
                      key={todo.id}
                      onClick={() => handleViewTodo(todo)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickMarkDone(todo);
                          }}
                          className={`h-4 w-4 flex-shrink-0 rounded-full border inline-block ${
                            todo.status === 'completed'
                              ? 'bg-green-600 border-green-600'
                              : 'border-gray-400 hover:border-green-500'
                          }`}
                          aria-label={`mark ${todo.title} done`}
                        />
                        <span
                          className={`flex-1 truncate text-sm ${
                            todo.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'
                          }`}
                        >
                          {todo.title}
                        </span>
                      </div>
                      {(todo.description || todo.due_date || isOverdue) && (
                        <div className="mt-1 pl-6 text-xs text-gray-500 flex items-center gap-2">
                          {todo.user_id && <span className="font-medium text-gray-600">{userMap[todo.user_id] || 'Assigned'}</span>}
                          {todo.description && <span className="truncate">{todo.description}</span>}
                          {todo.due_date && <span>{format(new Date(todo.due_date), 'MMM d')}</span>}
                          {isOverdue && <span className="text-red-600 font-medium">Overdue</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ))}
      </div>

      {filteredTodos.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="✓"
            title={searchQuery ? 'No tasks match your search' : 'No tasks'}
            description={searchQuery ? 'Try a different search term' : 'Create your first task to get started'}
          />
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        maxWidth="lg"
        title={isEditing ? (selectedTodo ? 'Edit Task' : 'New Task') : (selectedTodo?.title ?? '')}
        footer={
          showDeleteConfirm ? undefined : isEditing && !selectedTodo ? (
            <>
              <button
                onClick={handleSaveTodo}
                className="btn btn-primary"
                disabled={isSaving || !formData.title.trim()}
              >
                {isSaving ? 'Saving...' : 'Save Todo'}
              </button>
            </>
          ) : isEditing ? (
            <>
              <button onClick={handleSaveTodo} className="btn btn-primary" disabled={isSaving || !formData.title.trim()}>
                {isSaving ? 'Saving...' : 'Edit'}
              </button>
            </>
          ) : (
            <ModalRecordActions
              onDelete={() => setShowDeleteConfirm(true)}
              onEdit={handleEditTodo}
              onTertiary={selectedTodo?.status !== 'completed' ? handleMarkDone : undefined}
              tertiaryLabel={selectedTodo?.status !== 'completed' ? 'Mark Done' : undefined}
              tertiaryDisabled={isSaving}
            />
          )
        }
      >
        {isEditing ? (
          selectedTodo ? (
            <div className="space-y-4">
              <div>
                <label className="label">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  placeholder="Task title..."
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input min-h-[120px] resize-none"
                  placeholder="Task description..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as Todo['status'] })}
                    className="select"
                  >
                    <option value="pending">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as Todo['priority'] })}
                    className="select"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Assignee (optional)</label>
                <select
                  value={formData.user_id}
                  onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                  className="select"
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Due Date</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="input"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="label text-base">What do you want to do?</label>
                <textarea
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input min-h-[96px] resize-none"
                  placeholder=""
                  autoFocus
                />
              </div>

              <div>
                <label className="label text-base">When do you want to do this?</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateDuePreset('today')}
                    className={`btn btn-sm ${
                      createDuePreset === 'today'
                        ? 'btn-primary'
                        : 'btn-ghost'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateDuePreset('this_week')}
                    className={`btn btn-sm ${
                      createDuePreset === 'this_week'
                        ? 'btn-primary'
                        : 'btn-ghost'
                    }`}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateDuePreset('eventually')}
                    className={`btn btn-sm ${
                      createDuePreset === 'eventually'
                        ? 'btn-primary'
                        : 'btn-ghost'
                    }`}
                  >
                    Eventually
                  </button>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowOptionalCreateFields((prev) => !prev)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  {showOptionalCreateFields ? '▼ Optional fields' : '▶ Optional fields'}
                </button>

                {showOptionalCreateFields && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="label">Description</label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="input min-h-[96px] resize-none"
                        placeholder="Optional note..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Priority</label>
                        <select
                          value={formData.priority}
                          onChange={(e) => setFormData({ ...formData, priority: e.target.value as Todo['priority'] })}
                          className="select"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Assignee</label>
                        <select
                          value={formData.user_id}
                          onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                          className="select"
                        >
                          <option value="">Unassigned</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>{user.full_name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label">Custom due date</label>
                      <input
                        type="date"
                        value={formData.due_date}
                        onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                        className="input"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : selectedTodo ? (
          showDeleteConfirm ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-4xl mb-3">🗑️</div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Delete this task?</h3>
              <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={handleDeleteTodo} className="btn btn-danger" disabled={isSaving}>
                  {isSaving ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selectedTodo.status]}`}>
                  {STATUS_LABELS[selectedTodo.status]}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${PRIORITY_COLORS[selectedTodo.priority]}`}>
                  {selectedTodo.priority} priority
                </span>
              </div>
              {selectedTodo.description && (
                <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedTodo.description}
                </p>
              )}
              {selectedTodo.user_id && (
                <div className="text-sm text-gray-500">
                  <span className="font-medium text-gray-700">Assigned:</span>{' '}
                  {userMap[selectedTodo.user_id] || 'Unknown'}
                </div>
              )}
              {selectedTodo.due_date && (
                <div className="text-sm text-gray-500">
                  <span className="font-medium text-gray-700">Due:</span>{' '}
                  {format(new Date(selectedTodo.due_date), 'PPP')}
                  {new Date(selectedTodo.due_date) < new Date() && selectedTodo.status !== 'completed' && (
                    <span className="ml-2 text-red-500 font-medium">(Overdue)</span>
                  )}
                </div>
              )}
              <div className="pt-4 border-t border-gray-100 text-xs text-gray-400 flex justify-between">
                <span>Created {format(new Date(selectedTodo.created_at), 'PPP')}</span>
                {selectedTodo.completed_at && (
                  <span>Done {format(new Date(selectedTodo.completed_at), 'PPP')}</span>
                )}
              </div>
            </div>
          )
        ) : null}
      </Modal>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </PageContainer>
  );
}
