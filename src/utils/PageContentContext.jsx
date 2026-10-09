import { createContext, useContext } from 'react';
import { getPageCopy } from '../constants/pageContent';

const PageContentContext = createContext({});

export const PageContentProvider = PageContentContext.Provider;

export const usePageContent = (pageId) => {
  const allContent = useContext(PageContentContext);
  return getPageCopy(pageId, allContent[pageId]);
};
