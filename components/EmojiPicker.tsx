'use client';

import { useState, useRef, useEffect } from 'react';

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  placeholder?: string;
}

const EMOJI_CATEGORIES = {
  'Food & Dining': ['🍕', '🍔', '🍟', '🌮', '🍱', '🍜', '☕', '🍺', '🍷', '🥗', '🍰', '🍪'],
  'Transportation': ['🚗', '🚕', '🚌', '🚎', '🏍️', '🚲', '✈️', '🚂', '🚇', '🛵', '🚙', '🛻'],
  'Shopping': ['🛒', '🛍️', '👕', '👗', '👠', '💄', '🎁', '📦', '💳', '🏪', '🏬', '🛏️'],
  'Entertainment': ['🎬', '🎮', '🎸', '🎨', '📚', '🎭', '🎪', '🎯', '🎲', '🎹', '🎤', '🎧'],
  'Health': ['🏥', '💊', '💉', '🩺', '🧬', '⚕️', '🏃', '💪', '🧘', '😷', '🩹', '🦷'],
  'Home': ['🏠', '🔑', '🛋️', '🛁', '🚿', '💡', '🔌', '📺', '🖥️', '📞', '🚪', '🪟'],
  'Bills & Utilities': ['⚡', '💧', '🔥', '📡', '📶', '📞', '💵', '💸', '🧾', '📄', '💰', '🏦'],
  'Education': ['📚', '✏️', '📝', '🎓', '🏫', '🖊️', '📖', '🧮', '🔬', '🧪', '📐', '🖍️'],
  'Finance': ['💰', '💵', '💴', '💶', '💷', '💳', '🏦', '💸', '📊', '📈', '💹', '🪙'],
  'Travel': ['✈️', '🏖️', '🏨', '🗺️', '🧳', '🎒', '🏔️', '🏝️', '🗼', '🎡', '🎢', '🎠'],
  'Symbols': ['⭐', '❤️', '💙', '💚', '💛', '💜', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣'],
  'Other': ['📌', '📍', '🎯', '🔖', '🏷️', '✅', '❌', '⚠️', '🔔', '⏰', '📅', '📆'],
};

export default function EmojiPicker({ value, onChange, placeholder = 'Pick an emoji' }: EmojiPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(Object.keys(EMOJI_CATEGORIES)[0]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    };

    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPicker]);

  const handleEmojiClick = (emoji: string) => {
    onChange(emoji);
    setShowPicker(false);
  };

  return (
    <div className="relative" ref={pickerRef}>
      <div className="flex gap-2">
        {/* Display current emoji or placeholder */}
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="w-16 h-10 rounded-lg border-2 border-blue-300 bg-blue-50 flex items-center justify-center text-2xl cursor-pointer hover:bg-blue-100 hover:border-blue-400 transition-all shadow-sm"
          title="Click to open emoji picker"
        >
          {value || '😊'}
        </button>

        {/* Text input for manual entry */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            placeholder={placeholder}
            maxLength={4}
          />
          <p className="text-xs text-gray-400 mt-1 absolute -bottom-5 left-0 whitespace-nowrap">
            ← Click box to pick emoji
          </p>
        </div>
      </div>

      {/* Emoji Picker Dropdown */}
      {showPicker && (
        <div className="absolute z-50 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
          {/* Category Tabs */}
          <div className="flex overflow-x-auto bg-gray-50 border-b border-gray-200 scrollbar-thin scrollbar-thumb-gray-400">
            {Object.keys(EMOJI_CATEGORIES).map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === category
                    ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Emoji Grid */}
          <div className="p-3 max-h-60 overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_CATEGORIES[selectedCategory as keyof typeof EMOJI_CATEGORIES].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiClick(emoji)}
                  className={`w-10 h-10 text-2xl rounded hover:bg-blue-50 transition-colors flex items-center justify-center ${
                    value === emoji ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                  }`}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Footer with clear button */}
          <div className="border-t border-gray-200 p-2 bg-gray-50 flex justify-between items-center">
            <span className="text-xs text-gray-500">Selected: {value || 'None'}</span>
            <button
              onClick={() => {
                onChange('');
                setShowPicker(false);
              }}
              className="text-xs text-red-600 hover:text-red-700 font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
