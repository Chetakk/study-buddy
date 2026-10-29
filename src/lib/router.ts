import { useEffect, useState } from 'react';

// Hash routes: #/, #/library, #/progress, #/group/3, #/source/12, #/watch/34
export interface Route {
  name: string;
  id?: number;
}

function parse(): Route {
  const [name = '', id] = location.hash.replace(/^#\/?/, '').split('/');
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
