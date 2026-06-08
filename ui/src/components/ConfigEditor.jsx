import { useState, useEffect } from 'react';

export function ConfigEditor({ path, data, onSave, onForceSave, onDelete, onReload, onClose, onHasChanges, canWrite, remoteChange }) {
  const [editMode, setEditMode] = useState('form'); // 'form' or 'json'
  const [jsonText, setJsonText] = useState('');
  const [formData, setFormData] = useState({});
  const [jsonError, setJsonError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data) {
      setJsonText(JSON.stringify(data, null, 2));
      setFormData(data);
      setHasChanges(false);
      setJsonError(null);
    }
  }, [data]);

  useEffect(() => {
    if (onHasChanges) onHasChanges(hasChanges);
  }, [hasChanges, onHasChanges]);

  const handleJsonChange = (value) => {
    setJsonText(value);
    setHasChanges(true);
    try {
      const parsed = JSON.parse(value);
      setFormData(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e.message);
    }
  };

  const handleFormFieldChange = (key, value) => {
    const newData = { ...formData };

    // Try to parse as JSON for complex values
    try {
      newData[key] = JSON.parse(value);
    } catch {
      newData[key] = value;
    }

    setFormData(newData);
    setJsonText(JSON.stringify(newData, null, 2));
    setHasChanges(true);
  };

  const handleAddField = () => {
    const key = prompt('Enter field name:');
    if (key && !formData.hasOwnProperty(key)) {
      handleFormFieldChange(key, '');
    }
  };

  const handleRemoveField = (key) => {
    const newData = { ...formData };
    delete newData[key];
    setFormData(newData);
    setJsonText(JSON.stringify(newData, null, 2));
    setHasChanges(true);
  };

  const handleSave = () => {
    if (jsonError) {
      alert('Please fix JSON errors before saving');
      return;
    }
    onSave(path, formData);
    setHasChanges(false);
  };

  const handleForceSave = () => {
    if (jsonError) {
      alert('Please fix JSON errors before saving');
      return;
    }
    onForceSave(path, formData);
    setHasChanges(false);
  };

  const handleReset = () => {
    setJsonText(JSON.stringify(data, null, 2));
    setFormData(data);
    setHasChanges(false);
    setJsonError(null);
  };

  const renderFormField = (key, value) => {
    const valueType = typeof value;
    const isComplex = valueType === 'object' && value !== null;

    return (
      <div key={key} className="form-field">
        <label>
          <span className="field-key">{key}</span>
          <span className="field-type">{isComplex ? (Array.isArray(value) ? 'array' : 'object') : valueType}</span>
        </label>
        {isComplex ? (
          <textarea
            value={JSON.stringify(value, null, 2)}
            onChange={(e) => handleFormFieldChange(key, e.target.value)}
            rows={Math.min(10, JSON.stringify(value, null, 2).split('\n').length + 1)}
            disabled={!canWrite}
          />
        ) : valueType === 'boolean' ? (
          <select
            value={value.toString()}
            onChange={(e) => handleFormFieldChange(key, e.target.value)}
            disabled={!canWrite}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : valueType === 'number' ? (
          <input
            type="number"
            value={value}
            onChange={(e) => handleFormFieldChange(key, e.target.value)}
            disabled={!canWrite}
          />
        ) : (
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => handleFormFieldChange(key, e.target.value)}
            disabled={!canWrite}
          />
        )}
        <button
          className="remove-field"
          onClick={() => handleRemoveField(key)}
          title={canWrite ? 'Remove field' : 'No write permission'}
          disabled={!canWrite}
        >
          x
        </button>
      </div>
    );
  };

  return (
    <div className="config-editor">
      <div className="editor-header">
        <h2>{path}</h2>
        {!canWrite && <span className="readonly-badge">Read Only</span>}
        <div className="editor-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      {remoteChange && !remoteChange.conflict && (
        <div className="remote-change-banner warning-banner">
          <span>This configuration was modified externally. Your unsaved changes may conflict.</span>
          <button onClick={onReload}>Reload</button>
        </div>
      )}

      {remoteChange && remoteChange.conflict && (
        <div className="remote-change-banner conflict-banner">
          <span>Save failed: another user modified this configuration.</span>
          <div className="conflict-actions">
            <button onClick={onReload}>Reload (discard my changes)</button>
            <button onClick={handleForceSave} className="btn-force">Force save (overwrite)</button>
          </div>
        </div>
      )}

      <div className="editor-tabs">
        <button
          className={editMode === 'form' ? 'active' : ''}
          onClick={() => setEditMode('form')}
        >
          Form
        </button>
        <button
          className={editMode === 'json' ? 'active' : ''}
          onClick={() => setEditMode('json')}
        >
          JSON
        </button>
      </div>

      <div className="editor-content">
        {editMode === 'form' ? (
          <div className="form-editor">
            {Object.entries(formData).map(([key, value]) =>
              renderFormField(key, value)
            )}
            {Object.keys(formData).length === 0 && (
              <p className="empty-config">
                {canWrite ? 'No fields. Click "Add Field" to add one.' : 'No fields.'}
              </p>
            )}
            <button
              className="add-field"
              onClick={handleAddField}
              disabled={!canWrite}
              title={canWrite ? 'Add field' : 'No write permission'}
            >
              + Add Field
            </button>
          </div>
        ) : (
          <div className="json-editor">
            <textarea
              value={jsonText}
              onChange={(e) => handleJsonChange(e.target.value)}
              className={jsonError ? 'has-error' : ''}
              spellCheck={false}
              disabled={!canWrite}
            />
            {jsonError && <div className="json-error">{jsonError}</div>}
          </div>
        )}
      </div>

      <div className="editor-footer">
        <button
          className="btn-delete"
          onClick={() => onDelete(path)}
          disabled={!canWrite}
          title={canWrite ? 'Delete configuration' : 'No write permission'}
        >
          Delete
        </button>
        <div className="editor-footer-right">
          {hasChanges && canWrite && (
            <button onClick={handleReset}>Reset</button>
          )}
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={!canWrite || !hasChanges || jsonError}
            title={canWrite ? 'Save changes' : 'No write permission'}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
