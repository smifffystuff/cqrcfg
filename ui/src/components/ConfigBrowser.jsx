import { useState } from 'react';
import { api } from '../api';

export function ConfigBrowser({
  currentPath,
  paths,
  selectedPath,
  onNavigateUp,
  onNavigateTo,
  onSelectPath,
  onCreateNew,
  token,
  canWrite,
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [goToPath, setGoToPath] = useState('');

  const getDisplayName = (path) => {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  };

  const getRelativePath = (path) => {
    if (path.startsWith(currentPath + '/')) {
      return path.slice(currentPath.length + 1);
    }
    if (path === currentPath) {
      return getDisplayName(path);
    }
    return path;
  };

  const isDirectory = (path) => {
    return paths.some((p) => p !== path && p.startsWith(path + '/'));
  };

  const getImmediateChildren = () => {
    const children = new Set();
    const prefix = currentPath === '/config' ? currentPath : currentPath;

    for (const path of paths) {
      if (path === currentPath) continue;

      const relative = path.slice(prefix.length + 1);
      const firstSegment = relative.split('/')[0];
      if (firstSegment) {
        children.add(`${prefix}/${firstSegment}`);
      }
    }

    return Array.from(children).sort();
  };

  const immediateChildren = getImmediateChildren();

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newKeyName) return;

    const newPath = `${currentPath}/${newKeyName}`;
    onCreateNew(newPath, {});
    setShowCreateModal(false);
    setNewKeyName('');
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || !token) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      // Build search pattern - if query doesn't start with /, search under current path
      let pattern = searchQuery.trim();
      if (!pattern.startsWith('/')) {
        // Auto-add wildcards for convenience: "db" -> "**/db**"
        if (!pattern.includes('*') && !pattern.includes('?')) {
          pattern = `**/*${pattern}*`;
        }
        pattern = `${currentPath}/${pattern}`;
      }

      const result = await api.searchPaths(pattern, token);
      setSearchResults(result.keys || []);
    } catch (err) {
      setSearchError(err.message);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
  };

  const handleItemClick = (path) => {
    const hasChildren = paths.some((p) => p !== path && p.startsWith(path + '/'));
    if (hasChildren) {
      onNavigateTo(path);
    } else {
      onSelectPath(path);
    }
  };

  const handleItemDoubleClick = (path) => {
    onSelectPath(path);
  };

  // Determine which paths to display
  const displayPaths = searchResults !== null ? searchResults : immediateChildren;
  const isShowingSearchResults = searchResults !== null;

  return (
    <div className="config-browser">
      <div className="browser-header">
        <div className="path-breadcrumb">
          {currentPath.split('/').filter(Boolean).map((segment, index, arr) => {
            const path = '/' + arr.slice(0, index + 1).join('/');
            return (
              <span key={path}>
                <button
                  className="breadcrumb-link"
                  onClick={() => { onNavigateTo(path); clearSearch(); }}
                >
                  {segment}
                </button>
                {index < arr.length - 1 && <span className="breadcrumb-sep">/</span>}
              </span>
            );
          })}
        </div>
      </div>

      <form className="search-form" onSubmit={(e) => {
        e.preventDefault();
        if (!goToPath.trim()) return;
        let target = goToPath.trim();
        if (!target.startsWith('/config')) {
          target = `/config${target.startsWith('/') ? '' : '/'}${target}`;
        }
        onNavigateTo(target);
        setGoToPath('');
        clearSearch();
      }}>
        <input
          type="text"
          className="search-input"
          placeholder="Go to path... /config/app/db"
          value={goToPath}
          onChange={(e) => setGoToPath(e.target.value)}
        />
        <button type="submit" disabled={!goToPath.trim()}>
          Go
        </button>
      </form>

      <form className="search-form" onSubmit={handleSearch}>
        <input
          type="text"
          className="search-input"
          placeholder="Search keys... (*, **, ?)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button type="submit" disabled={isSearching || !searchQuery.trim()}>
          {isSearching ? '...' : 'Search'}
        </button>
        {isShowingSearchResults && (
          <button type="button" onClick={clearSearch} className="clear-search">
            Clear
          </button>
        )}
      </form>

      {searchError && <div className="search-error">{searchError}</div>}

      <div className="browser-toolbar">
        <button
          onClick={() => { onNavigateUp(); clearSearch(); }}
          disabled={currentPath === '/config'}
          title="Go up"
        >
          ..
        </button>
        <button
          onClick={() => setShowCreateModal(true)}
          title={canWrite ? 'Create new' : 'No write permission'}
          disabled={!canWrite}
        >
          + New
        </button>
        {isShowingSearchResults && (
          <span className="search-count">{searchResults.length} results</span>
        )}
      </div>

      <ul className="path-list">
        {displayPaths.length === 0 && (
          <li className="empty-message">
            {isShowingSearchResults ? 'No matching configurations found' : 'No configurations found'}
          </li>
        )}
        {displayPaths.map((path) => {
          const hasChildren = paths.some((p) => p !== path && p.startsWith(path + '/'));
          const isExact = paths.includes(path);

          return (
            <li
              key={path}
              className={`path-item ${selectedPath === path ? 'selected' : ''} ${hasChildren ? 'has-children' : ''}`}
              onClick={() => isShowingSearchResults ? onSelectPath(path) : handleItemClick(path)}
              onDoubleClick={() => handleItemDoubleClick(path)}
            >
              <span className="path-icon">{hasChildren && !isShowingSearchResults ? '/' : ''}</span>
              <span className="path-name">
                {isShowingSearchResults ? path : getDisplayName(path)}
              </span>
              {isExact && !isShowingSearchResults && <span className="path-badge">value</span>}
            </li>
          );
        })}
      </ul>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Configuration</h3>
            <form onSubmit={handleCreate}>
              <label>
                Path: {currentPath}/
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="key-name"
                  autoFocus
                  pattern="[a-zA-Z0-9_-]+"
                  title="Alphanumeric, dash, and underscore only"
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={!newKeyName}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
