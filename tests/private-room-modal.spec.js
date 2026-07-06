import { test, expect } from '@playwright/test';
import {
  goHome,
  openPrivateRoomModal,
  fillSettingsForm,
  readSettingsForm,
  DEFAULT_SETTINGS_FORM
} from './utils.js';

test.describe('Create Private Room modal - open/close', () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
  });

  test('opens from the home page with every setting at its default', async ({ page }) => {
    await openPrivateRoomModal(page);
    await expect(page.locator('.modal h2')).toHaveText('Create Private Room');
    expect(await readSettingsForm(page)).toEqual({
      ...DEFAULT_SETTINGS_FORM,
      customWords: '',
      customOnly: false
    });
  });

  test('closes via the × button and returns to the home screen', async ({ page }) => {
    await openPrivateRoomModal(page);
    await page.click('.close-button');
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await expect(page.locator('.home-hero')).toBeVisible();
  });

  test('closes via clicking the backdrop outside the modal card', async ({ page }) => {
    await openPrivateRoomModal(page);
    await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  });

  test('stays open when clicking inside the modal card itself', async ({ page }) => {
    await openPrivateRoomModal(page);
    await page.locator('.modal h2').click();
    await expect(page.locator('.modal-backdrop')).toBeVisible();
  });
});

test.describe('Create Private Room modal - changing individual settings', () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
  });

  test('Players: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="players"]');
    for (const value of ['2', '5', '10', '20']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Draw Time: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="drawTime"]');
    for (const value of ['30', '60', '120', '180']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Rounds: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="rounds"]');
    for (const value of ['1', '5', '10']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Game Mode: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="mode"]');
    for (const value of ['Normal', 'Hidden', 'Combination']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Word Count: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="wordCount"]');
    for (const value of ['1', '3', '5']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Hints: every option can be selected', async ({ page }) => {
    const select = page.locator('#settings-form select[name="hints"]');
    for (const value of ['0', '2', '5']) {
      await select.selectOption(value);
      await expect(select).toHaveValue(value);
    }
  });

  test('Custom Words: textarea accepts and reflects typed comma-separated words', async ({ page }) => {
    const textarea = page.locator('#settings-form textarea[name="customWords"]');
    await textarea.fill('apple, banana, cherry');
    await expect(textarea).toHaveValue('apple, banana, cherry');
  });

  test('Use Custom Words Only: checkbox toggles on and off', async ({ page }) => {
    const checkbox = page.locator('#settings-form input[name="customOnly"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  test('all settings can be changed together in one pass', async ({ page }) => {
    await fillSettingsForm(page, {
      players: 6,
      drawTime: 100,
      rounds: 7,
      mode: 'Hidden',
      wordCount: 4,
      hints: 1,
      customWords: 'sun, moon, star',
      customOnly: true
    });

    expect(await readSettingsForm(page)).toEqual({
      players: '6',
      drawTime: '100',
      rounds: '7',
      mode: 'Hidden',
      wordCount: '4',
      hints: '1',
      customWords: 'sun, moon, star',
      customOnly: true
    });
  });
});

test.describe('Create Private Room modal - starting the room', () => {
  test('Start! creates a room and applies every configured setting', async ({ page }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await fillSettingsForm(page, {
      players: 4,
      drawTime: 40,
      rounds: 6,
      mode: 'Combination',
      wordCount: 2,
      hints: 3,
      customWords: 'apple, banana',
      customOnly: false
    });
    await page.click('[data-action="start-private"]');

    await expect(page.locator('.game-topbar')).toBeVisible();
    await expect(page.locator('.round-chip')).toHaveText('Round 1/6');

    // Re-open the (now in-room) settings modal as the owner and confirm the
    // server echoed every configured value back via room:state.
    await page.click('[data-action="settings"]');
    await page.waitForSelector('#settings-form');
    expect(await readSettingsForm(page)).toEqual({
      players: '4',
      drawTime: '40',
      rounds: '6',
      mode: 'Combination',
      wordCount: '2',
      hints: '3',
      customWords: 'apple, banana',
      customOnly: false
    });
  });

  test('the settings gear is disabled for a non-owner joiner', async ({ page, browser }) => {
    await goHome(page);
    await openPrivateRoomModal(page);
    await page.click('[data-action="start-private"]');
    await expect(page.locator('.game-topbar')).toBeVisible();
    const code = await page.locator('.game-topbar strong').innerText();

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await goHome(guestPage);
    await guestPage.fill('#room-code', code);
    await guestPage.fill('#player-name', 'Guest');
    await guestPage.click('[data-action="join-room"]');
    await guestPage.waitForSelector('.game-topbar');

    await expect(page.locator('[data-action="settings"]')).toBeEnabled();
    await expect(guestPage.locator('[data-action="settings"]')).toBeDisabled();

    await guestContext.close();
  });
});
