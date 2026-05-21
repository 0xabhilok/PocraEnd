'use strict';

// Unit tests for the pure logic modules (no Electron / no DB needed).
// Run:  node test-logic.js

const sm = require('./electron/main/session-manager');

let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`OK    ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
}

// --- session lifecycle ---
sm.startSession({ sessionId: 1, topic: 'React assignment', workType: 'coding', durationMin: 25 });
check('session is active after start', sm.isActive() === true);
check('topic stored', sm.getState().topic === 'React assignment');
check('plannedEndTime is ~25 min ahead',
  Math.abs(sm.getState().plannedEndTime - sm.getState().startTime - 25 * 60000) < 50);

// --- snooze accounting ---
check('starts with 2 snoozes', sm.snoozesLeft() === 2);
sm.startSnooze(50);
check('1 snooze left after first', sm.snoozesLeft() === 1);
check('inSnoozeWindow is true', sm.getState().inSnoozeWindow === true);
sm.startSnooze(50);
check('0 snoozes left after second', sm.snoozesLeft() === 0);
sm.startSnooze(50);
check('snoozesLeft never goes negative', sm.snoozesLeft() === 0);

// --- whitelist ---
sm.addWhitelist({ url: 'https://youtube.com/watch?v=x', domain: 'youtube.com' });
check('exact url is whitelisted', sm.isWhitelisted({ url: 'https://youtube.com/watch?v=x' }) === true);
check('domain is whitelisted', sm.isWhitelisted({ domain: 'youtube.com' }) === true);
check('unrelated url is NOT whitelisted', sm.isWhitelisted({ url: 'https://reddit.com' }) !== true);
sm.addWhitelist({ appName: 'Spotify' });
check('desktop app is whitelisted by name', sm.isWhitelisted({ appName: 'Spotify' }) === true);
check('other app is NOT whitelisted', sm.isWhitelisted({ appName: 'Discord' }) !== true);

// --- drift reset ---
sm.getState().currentDrift.url = 'https://distraction.com';
sm.resetDrift();
check('resetDrift clears currentDrift.url', sm.getState().currentDrift.url === null);
check('resetDrift clears popupShown', sm.getState().currentDrift.popupShown === false);

// --- stop ---
sm.stopSession();
check('session inactive after stop', sm.isActive() === false);
check('sessionId cleared after stop', sm.getState().sessionId === null);

// --- a fresh session must reset per-session state ---
sm.startSession({ sessionId: 2, topic: 'DBMS', workType: 'studying', durationMin: 10 });
check('snoozes reset to 2 on new session', sm.snoozesLeft() === 2);
check('url whitelist cleared on new session',
  sm.isWhitelisted({ domain: 'youtube.com' }) !== true);
check('app whitelist cleared on new session',
  sm.isWhitelisted({ appName: 'Spotify' }) !== true);
sm.stopSession();

console.log('');
console.log('='.repeat(50));
console.log(`session-manager: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
