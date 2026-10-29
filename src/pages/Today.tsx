import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { notifyChanged } from '../lib/events.ts';
import { ErrorBox } from '../components/ui.tsx';
import type { Today } from '../types.ts';
import { FlashcardsCard, ResumeCard, TodayCard } from './today/TopRow.tsx';
import { Groups } from './today/Groups.tsx';
import { FirstRun } from './today/FirstRun.tsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function TodayPage() {
  const { data, error, reload, setData } = useLoad(() => api.get<Today>('/today'));
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const changed = () => {
    reload();
    notifyChanged();
  };

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="today-page">
      <div className="hello">
        <h1>{greeting()}</h1>
        <p>{date}</p>
      </div>

      {!data ? (
        <Skeleton />
      ) : data.allGroups.length === 0 ? (
        <FirstRun onDone={changed} />
      ) : (
        <>
          <div className="top">
            <ResumeCard r={data.resume} onChange={changed} />
            <TodayCard data={data} />
            <FlashcardsCard />
          </div>
          <Groups
            groups={data.groups}
            all={data.allGroups}
            setGroups={(groups) => setData({ ...data, groups })}
            onChange={changed}
          />
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skel" aria-busy="true" aria-label="Loading">
      <div className="top">
        <div className="sk resume" style={{ minHeight: 250 }} />
        <div className="sk" />
        <div className="sk" />
      </div>
      <div className="sk" style={{ height: 24, width: 160, borderRadius: 8 }} />
      <div className="tiles">
        <div className="sk" style={{ height: 210 }} />
        <div className="sk" style={{ height: 210 }} />
        <div className="sk" style={{ height: 210 }} />
      </div>
    </div>
  );
}
