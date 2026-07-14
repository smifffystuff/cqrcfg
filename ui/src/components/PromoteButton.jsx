import { useState } from 'react';

const PROMOTION_BRANCH = window.__CQRCFG_GIT_PROMOTION_BRANCH__ || '';

export function PromoteButton({ path, onPromote }) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!PROMOTION_BRANCH) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onPromote(path);
      setShowModal(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="btn-promote"
        onClick={() => setShowModal(true)}
        title={`Promote to ${PROMOTION_BRANCH}`}
      >
        Promote
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => !loading && setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Promote Configuration</h3>
            <p>
              Are you sure you want to promote <code>{path}</code> to
              branch <code>{PROMOTION_BRANCH}</code>?
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowModal(false)} disabled={loading}>
                Cancel
              </button>
              <button
                className="btn-promote-confirm"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? 'Promoting...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
