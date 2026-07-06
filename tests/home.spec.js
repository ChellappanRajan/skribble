import { test, expect } from '@playwright/test';
import { goHome, setNickname, quickPlay, joinRoomByCode, getRoomCode } from './utils.js';

test.describe('Home page - layout', () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
  });

  test('renders branding, nickname and room code inputs, and the primary actions', async ({ page }) => {
    await expect(page.locator('.brand-lockup h1')).toHaveText('skribble');
    await expect(page.locator('#player-name')).toBeVisible();
    await expect(page.locator('#player-name')).toHaveValue('Player');
    await expect(page.locator('#room-code')).toBeVisible();
    await expect(page.locator('#room-code')).toHaveValue('');
    await expect(page.locator('[data-action="quick-play"]')).toHaveText('Play!');
    await expect(page.locator('[data-action="join-room"]')).toHaveText('Join Room');
    await expect(page.locator('[data-action="private-room"]')).toHaveText('Create Private Room');
  });

  test('language select lists all supported languages with English selected by default', async ({ page }) => {
    const select = page.locator('#language-select');
    await expect(select).toHaveValue('English');
    const options = await select.locator('option').allInnerTexts();
    expect(options).toEqual(['English', 'German', 'Spanish', 'French', 'Japanese', 'Portuguese', 'Turkish']);
  });

  test('info band explains rooms, how to play, and realtime scope', async ({ page }) => {
    const headings = await page.locator('.info-band h2').allInnerTexts();
    expect(headings).toEqual(['Live Rooms', 'How to play', 'Realtime scope']);
    await expect(page.locator('.info-band')).toContainText('The active drawer chooses a word.');
    await expect(page.locator('.info-band')).toContainText('Socket.IO');
  });

  test('nickname input accepts typed text and is capped at 18 characters', async ({ page }) => {
    const input = page.locator('#player-name');
    await expect(input).toHaveAttribute('maxlength', '18');
    await setNickname(page, 'Alice');
    await expect(input).toHaveValue('Alice');
  });

  test('room code input uppercases whatever is typed', async ({ page }) => {
    const input = page.locator('#room-code');
    await input.fill('abc123');
    await expect(input).toHaveValue('ABC123');
  });
});

test.describe('Home page - Quick Play', () => {
  test('creates a room and switches into the room view with a live room code', async ({ page }) => {
    await goHome(page);
    await quickPlay(page, 'Alice');

    await expect(page.locator('.game-topbar')).toBeVisible();
    const code = await getRoomCode(page);
    expect(code).toMatch(/^[A-Z0-9]{1,8}$/);

    // URL is updated to the shareable invite form.
    await expect(page).toHaveURL(new RegExp(`\\?${code}$`));
  });

  test('the creator becomes the room owner and first player', async ({ page }) => {
    await goHome(page);
    await quickPlay(page, 'Alice');

    const row = page.locator('.player-row').first();
    await expect(row).toContainText('Alice');
    await expect(row.locator('[title="Owner"]')).toBeVisible();
  });

  test('falls back to the "Player" name when the nickname field is cleared', async ({ page }) => {
    await goHome(page);
    await page.fill('#player-name', '');
    await page.click('[data-action="quick-play"]');
    await page.waitForSelector('.game-topbar');
    await expect(page.locator('.player-row').first()).toContainText('Player');
  });

  test('the owner sees a word chooser immediately since they draw first', async ({ page }) => {
    await goHome(page);
    await quickPlay(page, 'Alice');
    await expect(page.locator('.word-chooser')).toBeVisible();
    const wordCount = await page.locator('.word-option').count();
    expect(wordCount).toBe(3); // default wordCount setting
  });
});

test.describe('Home page - Join Room', () => {
  test('shows a validation error when no room code is provided', async ({ page }) => {
    await goHome(page);
    await joinRoomByCode(page, { name: 'Bob' });
    await expect(page.locator('.error-banner')).toHaveText('Paste a room code or invite link code first.');
  });

  test('shows a server error for a room code that does not exist', async ({ page }) => {
    await goHome(page);
    await joinRoomByCode(page, { name: 'Bob', code: 'NOPE0000' });
    await expect(page.locator('.error-banner')).toHaveText('Room not found. Create a new room or check the invite code.');
  });

  test('joins an existing room created by another player', async ({ page, browser }) => {
    await goHome(page);
    await quickPlay(page, 'Alice');
    const code = await getRoomCode(page);

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await goHome(guestPage);
    await joinRoomByCode(guestPage, { name: 'Bob', code });

    await expect(guestPage.locator('.game-topbar')).toBeVisible();
    expect(await getRoomCode(guestPage)).toBe(code);

    const names = await page.locator('.player-row').allInnerTexts();
    expect(names.join(' ')).toContain('Bob');

    await guestContext.close();
  });

  test('an invite-style URL prefills the room code and shows an inline hint', async ({ page }) => {
    await page.goto('/?ZZZZZZZZ');
    await page.waitForSelector('.home-shell');
    await expect(page.locator('#room-code')).toHaveValue('ZZZZZZZZ');
    await expect(page.locator('.error-banner')).toContainText('Invite detected: ZZZZZZZZ');
  });
});
