import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import { getPageCopy, PAGE_CONTENT } from '../constants/pageContent';
import { auth, signInWithWorkspace } from './firebase';
import { loadSavedPageDrafts, savePageContent } from './content';
import { apiUrl } from './api';
import { retryableAdminAuthMessage, verifyAdminSession } from './adminAccess.js';
import { pageDraftFingerprint, pageDraftStatus, savePageDraftBatch } from './pageDrafts.js';

const PageContentContext = createContext({});
const PageEditorContext = createContext(null);

export function PageContentProvider({ value, children }) {
  const [adminUser, setAdminUser] = useState(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [authError, setAuthError] = useState('');
  const [authRetrying, setAuthRetrying] = useState(false);
  const [editMode, updateEditMode] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [savedDrafts, setSavedDrafts] = useState(null);
  const [draftStatusLoading, setDraftStatusLoading] = useState(false);
  const [draftStatusError, setDraftStatusError] = useState('');
  const [draftStatusRevision, setDraftStatusRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);

  useEffect(() => {
    if (!auth) return undefined;
    let revision = 0;
    return onIdTokenChanged(auth, async (user) => {
      const currentRevision = ++revision;
      // Firebase can restore a cached user before refreshing an expired token; a network failure here is retryable.
      const result = await verifyAdminSession(user);
      if (revision !== currentRevision) return;
      setAuthReady(true);
      if (result.status === 'retry') {
        setAuthError(result.message);
        return;
      }
      const approved = result.status === 'approved' ? result.user : null;
      setAuthError('');
      setAdminUser(approved);
      if (!approved) {
        updateEditMode(false);
        setDrafts({});
        setSavedDrafts(null);
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
      if (event.key?.startsWith('fcc-page-preview:') || event.key?.startsWith('fcc-page-saved:') || event.key === 'fcc-edit-mode') readDrafts();
      if (event.key?.startsWith('fcc-page-saved:')) setDraftStatusRevision((revision) => revision + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adminUser]);

  useEffect(() => {
    if (!adminUser) return undefined;
    let active = true;
    setDraftStatusLoading(true);
    setDraftStatusError('');
    const check = async () => {
      try {
        const token = await adminUser.getIdToken();
        const result = await loadSavedPageDrafts(token);
        if (active) setSavedDrafts(result.pages);
      } catch (error) {
        if (active) {
          setSavedDrafts(null);
          setDraftStatusError(`Saved-draft status could not be checked: ${error.message} Your browser drafts have been kept.`);
        }
      } finally {
        if (active) setDraftStatusLoading(false);
      }
    };
    check();
    return () => { active = false; };
  }, [adminUser, draftStatusRevision]);

  const retryDraftStatus = () => setDraftStatusRevision((revision) => revision + 1);

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
    setMessage('');
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
    setAuthError('');
    let user;
    try {
      user = await signInWithWorkspace();
    } catch (error) {
      const retryMessage = retryableAdminAuthMessage(error);
      if (retryMessage) {
        setAuthError(retryMessage);
        throw new Error(retryMessage);
      }
      throw error;
    }
    const result = await verifyAdminSession(user, true);
    if (result.status !== 'approved') {
      if (result.status === 'retry') {
        setAuthError(result.message);
        throw new Error(result.message);
      }
      await signOut(auth);
      throw new Error(result.message);
    }
    setAdminUser(user);
  };

  const retryAuth = async () => {
    if (authRetrying) return;
    setAuthRetrying(true);
    setAuthError('');
    try {
      const result = await verifyAdminSession(auth?.currentUser, true);
      if (result.status === 'retry') {
        setAuthError(result.message);
        return;
      }
      if (result.status === 'approved') {
        setAdminUser(result.user);
        setAuthReady(true);
        return;
      }
      setAdminUser(null);
      updateEditMode(false);
      setDrafts({});
      setSavedDrafts(null);
      setAuthError(result.message);
    } finally {
      setAuthRetrying(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setAdminUser(null);
    setEditMode(false);
    setDrafts({});
    setSavedDrafts(null);
    setDraftStatusError('');
    setAuthError('');
    setMessage('');
    setError('');
  };

  const { unsavedIds, unpublishedIds, uncheckedIds } = useMemo(() => pageDraftStatus(drafts, savedDrafts, value), [drafts, savedDrafts, value]);
  const pageLabels = (ids) => ids.map((pageId) => ({ id: pageId, label: PAGE_CONTENT[pageId]?.label || pageId }));
  const unsavedPages = pageLabels(unsavedIds);
  const unpublishedPages = pageLabels(unpublishedIds);
  const checkingDraftStatus = draftStatusLoading || (!draftStatusError && (savedDrafts === null || uncheckedIds.length > 0));

  const save = async (_pageId, publish = false) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!adminUser) throw new Error('Sign in with an approved editor account.');
      if (checkingDraftStatus || draftStatusError) throw new Error('Check saved-draft status before saving or requesting publication review.');
      const token = await adminUser.getIdToken(true);
      const pageIds = unsavedIds;
      if (!pageIds.length && !publish) {
        setMessage('There are no unsaved local changes.');
        return;
      }
      const contentByPage = Object.fromEntries(pageIds.map((pageId) => [pageId, getPageCopy(pageId, drafts[pageId] || value[pageId])]));
      let localTrackingFailed = false;
      const results = await savePageDraftBatch(pageIds, contentByPage, token, savePageContent, (pageId, content) => {
        const fingerprint = pageDraftFingerprint(content);
        setSavedDrafts((current) => ({ ...current, [pageId]: content }));
        try { localStorage.setItem(`fcc-page-saved:${pageId}`, fingerprint); }
        catch { localTrackingFailed = true; }
      });
      const warnings = [...new Set([
        ...results.map((result) => result.warning).filter(Boolean),
        ...(localTrackingFailed ? ['The pages were saved, but this browser could not remember their saved status.'] : [])
      ])];
      if (publish) {
        const response = await fetch(apiUrl('/api/admin/create-content-pr'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        });
        const pullRequest = await response.json();
        if (!response.ok) throw new Error(pullRequest.error || 'Could not create review PR.');
        setReview(pullRequest);
        setMessage(`Pull request #${pullRequest.number} is ready. Merging it publishes the saved changes.`);
        if (pullRequest.warning || warnings.length) setError([pullRequest.warning, ...warnings].filter(Boolean).join(' '));
      } else {
        const branches = [...new Set(results.map((result) => result.branch).filter(Boolean))];
        setMessage(`${results.length} page${results.length === 1 ? '' : 's'} saved${branches.length === 1 ? ` on ${branches[0]}` : ''}. Publication requires merging the review pull request.`);
        if (warnings.length) setError(warnings.join(' '));
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
      localStorage.removeItem(`fcc-page-saved:${pageId}`);
    } catch {
      setError('Could not clear local draft storage.');
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setMessage('Local changes for this page discarded.');
    setReview(null);
  };

  return (
    <PageEditorContext.Provider value={{ adminUser, authReady, authError, authRetrying, retryAuth, editMode, setEditMode, updatePage, login, logout, save, discard, busy, message, error, review, drafts, unsavedPages, unpublishedPages, checkingDraftStatus, draftStatusError, retryDraftStatus }}>
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
