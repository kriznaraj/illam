'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Tag } from '@/types';

interface TagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  userId?: string;
  dropdownMode?: 'absolute' | 'inline';
}

export default function TagSelector({
  selectedTags,
  onTagsChange,
  userId,
  dropdownMode = 'absolute',
}: TagSelectorProps) {
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchTags = useCallback(async () => {
    try {
      const url = userId ? `/api/tags?userId=${encodeURIComponent(userId)}` : '/api/tags';
      const res = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableTags(data);
      }
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  }, [userId]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Sanitize tag name: lowercase, remove special chars except underscore
  const sanitizeTagName = (input: string): string => {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, '') // Remove special chars except underscore and space
      .replace(/\s+/g, '_') // Replace spaces with underscore
      .replace(/_+/g, '_') // Remove duplicate underscores
      .trim();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setShowSuggestions(value.length > 0);
  };

  const handleTagRemove = (tagId: string) => {
    onTagsChange(selectedTags.filter(t => t.id !== tagId));
  };

  const getFilteredSuggestions = () => {
    // If no input, show all available tags (not already selected)
    if (!inputValue.trim()) {
      return availableTags.filter(tag =>
        !selectedTags.find(st => st.id === tag.id)
      );
    }

    const sanitized = sanitizeTagName(inputValue);
    if (!sanitized) {
      return availableTags.filter(tag =>
        !selectedTags.find(st => st.id === tag.id)
      );
    }

    // Filter tags that match the input and aren't already selected
    return availableTags.filter(tag =>
      tag.name.includes(sanitized) &&
      !selectedTags.find(st => st.id === tag.id)
    );
  };

  const createAndAddTag = async (tagName: string) => {
    const sanitized = sanitizeTagName(tagName);
    if (!sanitized) return;

    // Check if tag already exists
    const existing = availableTags.find(t => t.name === sanitized);
    if (existing) {
      // Add existing tag if not already selected
      if (!selectedTags.find(t => t.id === existing.id)) {
        onTagsChange([...selectedTags, existing]);
      }
      setInputValue('');
      setShowSuggestions(false);
      return;
    }

    // Create new tag (always shared for all users)
    setCreating(true);
    try {
      const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sanitized,
          color: randomColor,
          user_id: null,
          is_shared: true,
        }),
      });

      if (res.ok) {
        const newTag = await res.json();
        setAvailableTags([...availableTags, newTag]);
        onTagsChange([...selectedTags, newTag]);
        setInputValue('');
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error('Error creating tag:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      if (inputValue.trim()) {
        createAndAddTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
      // Remove last tag on backspace if input is empty
      onTagsChange(selectedTags.slice(0, -1));
    }
  };

  const handleSuggestionClick = (tag: Tag) => {
    if (!selectedTags.find(t => t.id === tag.id)) {
      onTagsChange([...selectedTags, tag]);
    }
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const suggestions = getFilteredSuggestions();
  const sanitizedInput = sanitizeTagName(inputValue);
  const exactMatch = suggestions.find(s => s.name === sanitizedInput);

  return (
    <div className="relative w-full">
      {/* Input Container */}
      <div
        className="flex flex-wrap gap-1.5 min-h-[40px] p-2 border border-gray-300 rounded-lg bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400"
        onClick={() => inputRef.current?.focus()}
        style={{ width: '100%', maxWidth: '100%' }}
      >
        {/* Selected Tags */}
        {selectedTags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-white bg-gray-700 shrink-0"
          >
            <span className="truncate max-w-[120px]">{tag.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleTagRemove(tag.id);
              }}
              className="hover:bg-black hover:bg-opacity-20 rounded px-0.5 flex-shrink-0 text-sm"
            >
              ×
            </button>
          </span>
        ))}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={selectedTags.length === 0 ? "Type to add..." : ""}
          className="outline-none"
          style={{ flex: '1 1 auto', minWidth: '80px', maxWidth: '100%', fontSize: '16px' }}
          disabled={creating}
        />
      </div>

      {/* Suggestions Dropdown - Absolute positioning */}
      {showSuggestions && (
        <div
          ref={dropdownRef}
          className={
            dropdownMode === 'inline'
              ? 'mt-1 bg-white border border-gray-300 rounded-lg shadow-xl overflow-y-auto'
              : 'absolute left-0 right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl overflow-y-auto z-50'
          }
          style={{
            maxHeight: '200px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {suggestions.length > 0 ? (
            <>
              {suggestions.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleSuggestionClick(tag);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 flex items-center gap-2 text-sm min-w-0"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="font-mono truncate flex-1 min-w-0 text-sm">{tag.name}</span>
                  {tag.is_shared && (
                    <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">shared</span>
                  )}
                </button>
              ))}
              {!exactMatch && sanitizedInput && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    createAndAddTag(inputValue);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-green-50 active:bg-green-100 flex items-center gap-2 text-sm text-green-700 border-t border-gray-200 min-w-0"
                >
                  <span className="text-sm flex-shrink-0">+</span>
                  <span className="truncate text-sm">Create: <span className="font-mono font-semibold">{sanitizedInput}</span></span>
                </button>
              )}
            </>
          ) : sanitizedInput ? (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                createAndAddTag(inputValue);
              }}
              className="w-full text-left px-3 py-2 hover:bg-green-50 active:bg-green-100 flex items-center gap-2 text-sm text-green-700 min-w-0"
            >
              <span className="text-sm flex-shrink-0">+</span>
              <span className="truncate text-sm">Create: <span className="font-mono font-semibold">{sanitizedInput}</span></span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
