import { SetMetadata } from '@nestjs/common';

export const BACKGROUND_CHECK = 'backgroundCheck';

// For endpoints an open page calls on its own every few seconds (e.g. "has
// anything changed?"). They don't count as activity: the session's idle timer
// keeps running, so staff are still signed out after 15 idle minutes (HIPAA
// automatic logoff) even with a page left open. Read by the session guards.
export const BackgroundCheck = () => SetMetadata(BACKGROUND_CHECK, true);
