// Shared Playwright helpers for the Skribble clone e2e suite.
// Mirrors selectors/markup from src/main.js so tests stay readable and DRY.

export const DEFAULT_SETTINGS_FORM = {
  players: '8',
  drawTime: '80',
  rounds: '3',
  mode: 'Normal',
  wordCount: '3',
  hints: '2'
};

// Kept in sync with the WORDS pool in server.js so tests can assert the
// default (non-custom) word pool is actually sourced from the server list.
export const DEFAULT_WORDS = [
  'rocket', 'island', 'guitar', 'castle', 'pizza', 'umbrella', 'dragon', 'camera',
  'bridge', 'scooter', 'volcano', 'robot', 'pancake', 'snowman', 'treasure',
  'wizard', 'bicycle', 'lighthouse', 'sandwich', 'spaceship', 'waterfall'
];

export async function goHome(page) {
  await page.goto('/');
  await page.waitForSelector('.home-shell');
}

export async function setNickname(page, name) {
  const input = page.locator('#player-name');
  await input.fill(name);
}

export async function quickPlay(page, name) {
  if (name !== undefined) await setNickname(page, name);
  await page.click('[data-action="quick-play"]');
  await page.waitForSelector('.game-topbar');
}

export async function joinRoomByCode(page, { name, code } = {}) {
  if (name !== undefined) await setNickname(page, name);
  if (code !== undefined) await page.fill('#room-code', code);
  await page.click('[data-action="join-room"]');
}

export async function openPrivateRoomModal(page) {
  await page.click('[data-action="private-room"]');
  await page.waitForSelector('#settings-form');
}

export async function openRoomSettingsModal(page) {
  await page.click('[data-action="settings"]');
  await page.waitForSelector('#settings-form');
}

// Applies only the provided fields, leaving the rest at whatever the form
// currently shows (mirrors how a user would only touch the fields they care about).
export async function fillSettingsForm(page, settings = {}) {
  const form = page.locator('#settings-form');
  if (settings.players !== undefined) await form.locator('select[name="players"]').selectOption(String(settings.players));
  if (settings.drawTime !== undefined) await form.locator('select[name="drawTime"]').selectOption(String(settings.drawTime));
  if (settings.rounds !== undefined) await form.locator('select[name="rounds"]').selectOption(String(settings.rounds));
  if (settings.mode !== undefined) await form.locator('select[name="mode"]').selectOption(String(settings.mode));
  if (settings.wordCount !== undefined) await form.locator('select[name="wordCount"]').selectOption(String(settings.wordCount));
  if (settings.hints !== undefined) await form.locator('select[name="hints"]').selectOption(String(settings.hints));
  if (settings.customWords !== undefined) await form.locator('textarea[name="customWords"]').fill(settings.customWords);
  if (settings.customOnly !== undefined) {
    const checkbox = form.locator('input[name="customOnly"]');
    const isChecked = await checkbox.isChecked();
    if (isChecked !== settings.customOnly) await checkbox.click();
  }
}

export async function readSettingsForm(page) {
  const form = page.locator('#settings-form');
  return {
    players: await form.locator('select[name="players"]').inputValue(),
    drawTime: await form.locator('select[name="drawTime"]').inputValue(),
    rounds: await form.locator('select[name="rounds"]').inputValue(),
    mode: await form.locator('select[name="mode"]').inputValue(),
    wordCount: await form.locator('select[name="wordCount"]').inputValue(),
    hints: await form.locator('select[name="hints"]').inputValue(),
    customWords: await form.locator('textarea[name="customWords"]').inputValue(),
    customOnly: await form.locator('input[name="customOnly"]').isChecked()
  };
}

export async function getRoomCode(page) {
  return page.locator('.game-topbar strong').innerText();
}

export async function getTimerSeconds(page) {
  const text = await page.locator('.timer').innerText();
  return Number(text.replace('s', ''));
}

export async function getWordOptions(page) {
  return page.locator('.word-option').allInnerTexts();
}
