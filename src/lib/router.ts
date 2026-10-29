import { useEffect, useState } from 'react';

// Hash routes: #/, #/library, #/progress, #/notes, #/group/3, #/source/12, #/watch/34 (or #/watch/34?t=90)
export interface Route {
  name: string;
  id?: number;
}

function parse(): Route {
  const [name = '', id] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  return { name: name || 'today', id: id ? Number(id) : undefined };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (path: string) => {
  location.hash = path;
};

// A query value from the hash, e.g. t in #/watch/34?t=90.
export const hashParam = (key: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(key);
