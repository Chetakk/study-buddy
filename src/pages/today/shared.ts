import type { CSSProperties } from 'react';
import { colorVar, fmtDuration } from '../../lib/format.ts';

export const minutes = (s: number) => (s < 60 ? `${Math.round(s / 60)}m` : fmtDuration(s));
export const cVar = (color: string) => ({ '--c': colorVar(color) }) as CSSProperties;
