'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { Note } from '@/types';
import { format } from 'date-fns';

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    tags: [] as string[],
    is_pinned: false,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotes = useCallback(async (search = '', isInitial = false) => {
    if (isInitial) setInitialLoading(true);
    try {
      const params = new URLSearchParams();
      if (showArchived) params.append('archived', 'true');
      if (search) params.append('search', search);
      const res = await fetch(`/api/notes?${params.toString()}`);
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchNotes('', true);
  }, [fetchNotes]);

  useEffect(() => {
    const handleCacheCleared = () => {
      fetchNotes(searchQuery);
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [fetchNotes, searchQuery]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchNotes(value), 300);
  };

  const handleCreateNote = () => {
    setSelectedNote(null);
    setIsEditing(true);
    setShowDeleteConfirm(false);
    setFormData({ title: '', content: '', tags: [], is_pinned: false });
    setShowModal(true);
  };

  const handleViewNote = (note: Note) => {
    setSelectedNote(note);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setShowModal(true);
  };

  const handleEditNote = () => {
    if (!selectedNote) return;
    setIsEditing(true);
    setShowDeleteConfirm(false);
    setFormData({
      title: selectedNote.title,
      content: selectedNote.content || '',
      tags: selectedNote.tags || [],
      is_pinned: selectedNote.is_pinned,
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setShowDeleteConfirm(false);
    setSelectedNote(null);
    setIsEditing(false);
  };

  const handleSaveNote = async () => {
    if (!formData.title.trim()) return;
    setIsSaving(true);
    try {
      if (selectedNote) {
        const res = await fetch('/api/notes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedNote.id, ...formData }),
        });
        if (res.ok) {
          const updated = await res.json();
          setSelectedNote(updated);
          setIsEditing(false);
          fetchNotes(searchQuery);
          setToast({ message: 'Note updated', type: 'success' });
        }
      } else {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          const created = await res.json();
          fetchNotes(searchQuery);
          // Transition to view mode of the new note
          setSelectedNote(created);
          setIsEditing(false);
          setToast({ message: 'Note created', type: 'success' });
        }
      }
    } catch (error) {
      console.error('Failed to save note:', error);
      setToast({ message: 'Failed to save note', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/notes?id=${selectedNote.id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchNotes(searchQuery);
        handleCloseModal();
        setToast({ message: 'Note deleted', type: 'success' });
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      setToast({ message: 'Failed to delete note', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id, is_pinned: !note.is_pinned }),
      });
      fetchNotes(searchQuery);
      setToast({ message: note.is_pinned ? 'Note unpinned' : 'Note pinned', type: 'info' });
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      setToast({ message: 'Failed to update note', type: 'error' });
    }
  };

  const handleToggleArchive = async (note: Note) => {
    try {
      await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id, is_archived: !note.is_archived }),
      });
      fetchNotes(searchQuery);
      handleCloseModal();
      setToast({ message: note.is_archived ? 'Note moved to active' : 'Note archived', type: 'info' });
    } catch (error) {
      console.error('Failed to toggle archive:', error);
      setToast({ message: 'Failed to update note', type: 'error' });
    }
  };

  if (initialLoading) return <LoadingSpinner message="Loading notes..." />;

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Kurippu"
        description="Personal notes and ideas"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="btn btn-secondary"
            >
              {showArchived ? '← Active' : 'Archived'}
            </button>
            <button onClick={handleCreateNote} className="btn btn-primary">
              + New Note
            </button>
          </div>
        }
      />

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="input"
        />
      </div>

      {/* Notes Grid */}
      {notes.length === 0 ? (
        <EmptyState
          icon="📝"
          title={searchQuery ? 'No notes match your search' : 'No notes yet'}
          description={searchQuery ? 'Try a different search term' : 'Create your first note to get started'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleViewNote(note)}
              className="card cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 flex-1 mr-2">
                  {note.is_pinned && <span className="mr-1">📌</span>}
                  {note.title}
                </h3>
                <button
                  onClick={(e) => handleTogglePin(note, e)}
                  className="text-gray-300 hover:text-yellow-400 transition-colors flex-shrink-0 text-lg leading-none"
                >
                  {note.is_pinned ? '★' : '☆'}
                </button>
              </div>
              {note.content && (
                <p className="text-sm text-gray-500 line-clamp-3 mb-3">{note.content}</p>
              )}
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
                <span>{format(new Date(note.updated_at), 'MMM d, yyyy')}</span>
                {(note.tags?.length ?? 0) > 0 && (
                  <div className="flex gap-1">
                    {(note.tags ?? []).slice(0, 2).map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        maxWidth="lg"
        title={isEditing ? (selectedNote ? 'Edit Note' : 'New Note') : (selectedNote?.title ?? '')}
        footer={
          showDeleteConfirm ? undefined : isEditing ? (
            <>
              <button
                onClick={handleSaveNote}
                className="btn btn-primary"
                disabled={isSaving || !formData.title.trim()}
              >
                {isSaving ? 'Saving...' : selectedNote ? 'Edit' : 'Create'}
              </button>
            </>
          ) : (
            <ModalRecordActions
              onDelete={() => setShowDeleteConfirm(true)}
              onEdit={handleEditNote}
              onTertiary={() => selectedNote && handleToggleArchive(selectedNote)}
              tertiaryLabel={selectedNote?.is_archived ? 'Unarchive' : 'Archive'}
            />
          )
        }
      >
        {isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="label">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input"
                placeholder="Note title..."
                autoFocus
              />
            </div>
            <div>
              <label className="label">Content</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                className="input min-h-[240px] font-mono text-sm resize-none"
                placeholder="Write your note here..."
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pinned"
                checked={formData.is_pinned}
                onChange={(e) => setFormData({ ...formData, is_pinned: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="pinned" className="text-sm text-gray-700">Pin this note</label>
            </div>
          </div>
        ) : selectedNote ? (
          showDeleteConfirm ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-4xl mb-3">🗑️</div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Delete this note?</h3>
              <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={handleDeleteNote} className="btn btn-danger" disabled={isSaving}>
                  {isSaving ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="whitespace-pre-wrap text-gray-700 text-sm leading-relaxed mb-6">
                {selectedNote.content || <span className="text-gray-400 italic">No content</span>}
              </div>
              {(selectedNote.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {(selectedNote.tags ?? []).map((tag, i) => (
                    <span key={i} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">{tag}</span>
                  ))}
                </div>
              )}
              <div className="pt-4 border-t border-gray-100 text-xs text-gray-400 flex justify-between">
                <span>Created {format(new Date(selectedNote.created_at), 'PPP')}</span>
                <span>Updated {format(new Date(selectedNote.updated_at), 'PPP')}</span>
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
