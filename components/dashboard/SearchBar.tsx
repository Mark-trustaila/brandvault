'use client';
import { useState, useEffect } from 'react';
import styles from './SearchBar.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { searchQueryFromUrl, withoutSearchParam } from '../../lib/deep-links';

/**
 * Drop ?q= from the address bar when the search is cleared, so the URL agrees
 * with the view and a refresh cannot resurrect the filter.
 *
 * replaceState rather than a router navigation: nothing needs to re-render or
 * re-run an arrival effect, only the address bar needs to catch up. Replacing
 * rather than pushing also keeps the back button meaning "the page before this
 * one" instead of "the filter you just dismissed".
 */
function clearSearchFromUrl() {
  const { pathname, search, hash } = window.location;
  if (!search) return;
  window.history.replaceState(null, '', `${pathname}${withoutSearchParam(search)}${hash}`);
}

export default function SearchBar() {
  const { searchQuery, setSearchQuery, data, filteredTrademarks } = useDashboard();
  // Local input value updates immediately for responsive feel;
  // the actual searchQuery (which drives filtering) is debounced 300ms.
  const [inputValue, setInputValue] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue, setSearchQuery]);

  // Keep local value in sync if searchQuery is cleared externally (e.g. clear button)
  useEffect(() => {
    if (searchQuery === '') setInputValue('');
  }, [searchQuery]);

  // Arriving from a Slack link with ?q=<text>: show that text in the box, so
  // the filtered view and the input agree and the user can edit or clear it
  // exactly as if they had typed it.
  //
  // Declared last on purpose. On mount the effects above run first with
  // searchQuery still '', and the clear-sync would otherwise wipe this seed.
  // Effects run in declaration order, so seeding last survives; afterwards
  // searchQuery is non-empty and the clear-sync no-ops.
  useEffect(() => {
    const q = searchQueryFromUrl(window.location.search);
    if (q) setInputValue(q);
  }, []);

  const matched = filteredTrademarks.length;

  return (
    <div className={styles.searchBar}>
      <span className={styles.icon}>🔍</span>
      <input
        type="text"
        className={styles.input}
        placeholder="Search marks, registries, application numbers…"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
      />
      {inputValue && (
        <span className={styles.count}>{matched}/{data?.count ?? 0}</span>
      )}
      <button
        className={`${styles.clear} ${inputValue ? styles.clearVisible : ''}`}
        onClick={() => { setInputValue(''); setSearchQuery(''); clearSearchFromUrl(); }}
      >
        ✕
      </button>
    </div>
  );
}
