import { test, expect } from '@playwright/test';
import {
  goHome,
  quickPlay,
  joinRoomByCode,
  getRoomCode,
  openPrivateRoomModal,
  openRoomSettingsModal,
  fillSettingsForm,
  readSettingsForm,
  getTimerSeconds,
  getWordOptions,
  DEFAULT_WORDS
} from './utils.js';

test.describe('Word Count setting', () => {
  test('the word chooser shows exactly as many options as Word Count', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { wordCount: 5 });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.word-chooser')).toBeVisible();
    expect(await page.locator('.word-option').count()).toBe(5);
  });

  test('with no custom words, choices come from the built-in word pool', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { wordCount: 3 });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.word-chooser')).toBeVisible();
    const words = await getWordOptions(page);
    expect(words).toHaveLength(3);
    for (const word of words) {
      expect(DEFAULT_WORDS).toContain(word);
    }
    // No duplicates.
    expect(new Set(words).size).toBe(words.length);
  });
});

test.describe('Custom Words + Use Custom Words Only', () => {
  test('word choices are drawn only from the custom list when the box is checked', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, {
      wordCount: 3,
      customWords: 'apple, banana, cherry',
      customOnly: true
    });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.word-chooser')).toBeVisible();

    const words = await getWordOptions(page);
    expect(words.sort()).toEqual(['apple', 'banana', 'cherry']);
  });

  test('custom words are merged with the default pool when the box is left unchecked', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    // A wordCount larger than the custom list forces at least one default word in.
    await fillSettingsForm(page, {
      wordCount: 5,
      customWords: 'apple, banana',
      customOnly: false
    });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.word-chooser')).toBeVisible();

    const words = await getWordOptions(page);
    expect(words).toHaveLength(5);
    const fromEitherPool = words.every((w) => DEFAULT_WORDS.includes(w) || ['apple', 'banana'].includes(w));
    expect(fromEitherPool).toBe(true);
  });

  test('blank/duplicate custom word entries are ignored', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, {
      wordCount: 5,
      customWords: 'apple,, apple , Banana ,   ,banana',
      customOnly: true
    });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.word-chooser')).toBeVisible();

    const words = await getWordOptions(page);
    // Only two distinct, trimmed, lowercased words exist in the pool.
    expect(words.sort()).toEqual(['apple', 'banana']);
  });
});

test.describe('Rounds and Draw Time', () => {
  test('round chip reflects the configured number of Rounds', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { rounds: 9 });
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.round-chip')).toHaveText('Round 1/9');
  });

  test('the draw timer starts at the configured Draw Time once a word is chosen', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { drawTime: 120 });
    await page.click('[data-action="start-private"]');

    await page.locator('.word-option').first().click();
    const seconds = await getTimerSeconds(page);
    expect(seconds).toBeLessThanOrEqual(120);
    expect(seconds).toBeGreaterThan(117); // allow a couple of ticks of network/render latency
  });
});

test.describe('Hints setting', () => {
  test('a guesser sees exactly as many revealed letters as Hints allows', async ({ page, browser }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, {
      wordCount: 1,
      hints: 1,
      customWords: 'apple',
      customOnly: true
    });
    await page.click('[data-action="start-private"]');
    const code = await getRoomCode(page);

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await goHome(guestPage);
    await joinRoomByCode(guestPage, { name: 'Guesser', code });
    await guestPage.waitForSelector('.game-topbar');

    await page.locator('.word-option').first().click(); // host draws 'apple'

    // apple -> 5 letters, hints=1 -> only the first letter revealed.
    await expect(guestPage.locator('.word-chip')).toHaveText('a _ _ _ _');
    // The drawer always sees the full word regardless of Hints.
    await expect(page.locator('.word-chip')).toHaveText('a p p l e');

    await guestContext.close();
  });
});

test.describe('Players setting', () => {
  test('a room rejects new joiners once it reaches the configured Players cap', async ({ page, browser }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { players: 2 });
    await page.click('[data-action="start-private"]');
    const code = await getRoomCode(page);

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await goHome(guestPage);
    await joinRoomByCode(guestPage, { name: 'Bob', code });
    await expect(guestPage.locator('.game-topbar')).toBeVisible();

    const overflowContext = await browser.newContext();
    const overflowPage = await overflowContext.newPage();
    await goHome(overflowPage);
    await joinRoomByCode(overflowPage, { name: 'Eve', code });
    await expect(overflowPage.locator('.error-banner')).toHaveText('That room is full.');

    await guestContext.close();
    await overflowContext.close();
  });
});

test.describe('Game Mode setting', () => {
  test('the selected Game Mode is persisted and echoed back by the server', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, { mode: 'Hidden' });
    await page.click('[data-action="start-private"]');

    await openRoomSettingsModal(page);
    expect((await readSettingsForm(page)).mode).toBe('Hidden');
  });
});

test.describe('Applying settings mid-room (owner)', () => {
  test('changing settings from the in-room gear icon takes effect immediately', async ({ page }) => {
    await goHome(page);
    await quickPlay(page, 'Alice'); // defaults: rounds=3, mode=Normal

    await openRoomSettingsModal(page);
    await fillSettingsForm(page, { rounds: 8, mode: 'Hidden', hints: 0 });
    await page.click('[data-action="apply-settings"]');

    await expect(page.locator('.round-chip')).toHaveText('Round 1/8');

    await openRoomSettingsModal(page);
    const settings = await readSettingsForm(page);
    expect(settings.rounds).toBe('8');
    expect(settings.mode).toBe('Hidden');
    expect(settings.hints).toBe('0');
  });
});
