'use client';

import { useState, useEffect, useRef } from 'react';

export interface AutocompleteOption {
  id: string;
  label: string;
  sublabel?: string;
  icon?: string;
  badge?: string;
  color?: string;
  [key: string]: string | undefined;
}

interface AutocompleteDropdownProps {
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string, option: AutocompleteOption | null) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  filterKeys?: string[];
  renderOption?: (option: AutocompleteOption) => React.ReactNode;
  emptyMessage?: string;
  allowClear?: boolean;
}

export default function AutocompleteDropdown({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  label,
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  filterKeys = ['label'],
  renderOption,
  emptyMessage = 'No matches found',
  allowClear = true,
}: AutocompleteDropdownProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input value with selected option
  useEffect(() => {
    const selectedOption = options.find(opt => opt.id === value);
    setInputValue(selectedOption ? selectedOption.label : '');
  }, [value, options]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSuggestions]);

  // Filter options based on input
  const filteredOptions = inputValue
    ? options.filter(option => {
        const searchValue = inputValue.toLowerCase();
        return filterKeys.some(key => {
          const fieldValue = option[key];
          return fieldValue && String(fieldValue).toLowerCase().includes(searchValue);
        });
      })
    : options;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowSuggestions(true);

    // Clear selection if input is cleared
    if (!newValue) {
      onChange('', null);
    }
  };

  const handleSelectOption = (option: AutocompleteOption) => {
    setInputValue(option.label);
    onChange(option.id, option);
    setShowSuggestions(false);
  };

  const handleClear = () => {
    setInputValue('');
    onChange('', null);
    inputRef.current?.focus();
  };

  const defaultRenderOption = (option: AutocompleteOption) => (
    <div className="flex items-center gap-2">
      {option.icon && <span className="text-lg flex-shrink-0">{option.icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{option.label}</p>
        {option.sublabel && (
          <p className="text-xs text-gray-500 truncate">{option.sublabel}</p>
        )}
      </div>
      {option.badge && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0">
          {option.badge}
        </span>
      )}
    </div>
  );

  return (
    <div className={`relative ${className}`} ref={inputRef}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={`input disabled:bg-gray-100 disabled:cursor-not-allowed ${inputClassName}`}
        />

        {allowClear && value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl leading-none"
            tabIndex={-1}
          >
            ×
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestions && inputValue && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSelectOption(option)}
                className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                {renderOption ? renderOption(option) : defaultRenderOption(option)}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500 text-center">
              {emptyMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
