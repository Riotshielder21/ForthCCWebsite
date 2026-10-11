import React, { createContext, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import { getPageCopy, PAGE_CONTENT } from '../constants/pageContent';
import { auth, signInWithWorkspace } from './firebase';
import { savePageContent } from './content';
import { apiUrl } from './api';

const PageContentContext = createContext({});
const PageEditorContext = createContext(null);

export function PageContentProvider({ value, children }) {
  const [adminUser, setAdminUser] = useState(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [editMode, updateEditMode] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);

  useEffect(() => {
    if (!auth) return undefined;
    let revision = 0;
    return onIdTokenChanged(auth, async (user) => {
      const currentRevision = ++revision;
      let approved = null;
      try {
        if (user && !user.isAnonymous) {
          const token = await user.getIdTokenResult();
          if (token.claims.admin === true && user.email?.toLowerCase().endsWith('@forthcanoeclub.co.uk')) approved = user;
        }
      } catch {
        approved = null;
      }
      if (revision !== currentRevision) return;
      setAdminUser(approved);
      setAuthReady(true);
      if (!approved) {
        updateEditMode(false);
        setDrafts({});
      }
    });
  }, []);

  useEffect(() => {
    if (!adminUser) return undefined;
    const readDrafts = () => {
      const restored = {};
      try {
        for (const pageId of Object.keys(PAGE_CONTENT)) {
          const stored = localStorage.getItem(`fcc-page-preview:${pageId}`);
          if (stored) restored[pageId] = JSON.parse(stored);
        }
        setDrafts(restored);
        updateEditMode(localStorage.getItem('fcc-edit-mode') === 'true');
      } catch {
        setError('Some local drafts could not be restored.');
      }
    };
    readDrafts();
    const onStorage = (event) => {
      if (event.key?.startsWith('fcc-page-preview:') || event.key === 'fcc-edit-mode') readDrafts();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adminUser, value]);

  const setEditMode = (enabled) => {
    updateEditMode(enabled);
    try { localStorage.setItem('fcc-edit-mode', String(enabled)); }
    catch { setError('Edit Mode cannot be synchronized with other previews in this browser.'); }
  };

  const updatePage = (pageId, content) => {
    setDrafts((current) => ({
      ...current,
      [pageId]: typeof content === 'function'
        ? content(getPageCopy(pageId, current[pageId] || value[pageId]))
        : content
    }));
    setMessage('Unpublished changes');
    setReview(null);
  };

  useEffect(() => {
    if (!adminUser) return;
    try {
      for (const [pageId, content] of Object.entries(drafts)) {
        localStorage.setItem(`fcc-page-preview:${pageId}`, JSON.stringify(content));
      }
    } catch {
      setError('Local draft storage is unavailable. Keep this tab open until you save.');
    }
  }, [drafts, adminUser]);

  const login = async () => {
    const user = await signInWithWorkspace();
    const token = await user.getIdTokenResult(true);
    if (token.claims.admin !== true) {
      await signOut(auth);
      throw new Error('This account is not an approved website editor.');
    }
    setAdminUser(user);
  };

  const logout = async () => {
    await signOut(auth);
    setAdminUser(null);
    setEditMode(false);
    setDrafts({});
    setMessage('');
    setError('');
  };

  const save = async (pageId, publish = false) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!adminUser) throw new Error('Sign in with an approved editor account.');
      const token = await adminUser.getIdToken(true);
      const result = await savePageContent(pageId, getPageCopy(pageId, drafts[pageId] || value[pageId]), token);
      if (publish) {
        const response = await fetch(apiUrl('/api/admin/create-content-pr'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        });
        const pullRequest = await response.json();
        if (!response.ok) throw new Error(pullRequest.error || 'Could not create review PR.');
        setReview(pullRequest);
        setMessage(`Pull request #${pullRequest.number} is ready. Merging it publishes the saved changes.`);
      } else {
        setMessage(`Draft saved on ${result.branch}. Not published yet.`);
      }
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const discard = (pageId) => {
    if (!window.confirm('Discard local changes for this page and restore published content? This does not remove drafts already saved to the review branch.')) return;
    try {
      localStorage.removeItem(`fcc-page-preview:${pageId}`);
    } catch {
      setError('Could not clear local draft storage.');
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setMessage('Local changes discarded.');
    setReview(null);
  };

  return (
    <PageEditorContext.Provider value={{ adminUser, authReady, editMode, setEditMode, updatePage, login, logout, save, discard, busy, message, error, review, drafts }}>
      <PageContentContext.Provider value={adminUser ? { ...value, ...drafts } : value}>
        {children}
      </PageContentContext.Provider>
    </PageEditorContext.Provider>
  );
}

export const usePageEditor = () => useContext(PageEditorContext);

export const usePageContent = (pageId) => {
  const allContent = useContext(PageContentContext);
  return getPageCopy(pageId, allContent[pageId]);
};
