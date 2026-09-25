import assert from 'node:assert/strict';

/** Browser focus/selection contracts use actual production React components. */
export async function checkDimensionInputs(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(url);
    await page.evaluate(async () => {
      const {mountDimensionInputContract} = await import('/src/components/DimensionInput.browser.test.tsx');
      window.unmountDimensionInputs = mountDimensionInputContract();
    });
    const measurement = page.getByTestId('external-thread-nominal');
    await page.waitForFunction(() => document.querySelector('[data-testid="external-thread-nominal"]')?.value === '12.3');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByRole('button', {name: 'Change support face'}).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="external-thread-nominal"]')?.value === '17.3');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await measurement.evaluate(input => input === document.activeElement));
    await page.keyboard.type('22');
    assert.equal(await measurement.inputValue(), '22', 'Geometry-derived values must be selected after their initializing effect');

    const input = page.locator('input[title*="Edit dimension"]');
    const expectSelected = async value => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await input.evaluate(input => ({
        value: input.value, start: input.selectionStart, end: input.selectionEnd,
        focused: input === document.activeElement,
      })), {value, start: 0, end: value.length, focused: true});
    };
    await page.getByRole('button', {name: 'Open dimension', exact: true}).click();
    await expectSelected('50');
    await page.keyboard.type('=25*2');
    assert.equal(await input.inputValue(), '=25*2', 'Opening selects the existing value without swallowing subsequent keystrokes');
    await page.getByRole('button', {name: 'Refresh sketch'}).click();
    assert.equal(await input.inputValue(), '=25*2', 'An ordinary sketch rerender must preserve the draft');
    await page.getByRole('button', {name: 'Open dimension', exact: true}).click();
    await expectSelected('50');
    await page.getByRole('button', {name: 'Restore 25 snapshot'}).click();
    await page.getByRole('button', {name: 'Open dimension', exact: true}).click();
    await expectSelected('25');
    await page.keyboard.type('30');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('1');
    assert.equal(await input.inputValue(), '310', 'Typing and arrow movement must not continually reselect or reset the draft');
    await page.getByRole('button', {name: 'Open other dimension'}).click();
    await expectSelected('7');
    await page.keyboard.press('Escape');
    await input.waitFor({state: 'detached'});
    await page.getByRole('button', {name: 'Open dimension', exact: true}).click();
    await expectSelected('25');
    assert.deepEqual(errors, []);
    return ['effect-seeded-value', 'initial-selection', 'formula-typing', 'same-ID-reopen',
      'changed-initial-reopen', 'draft-preservation', 'caret-movement', 'different-ID', 'Escape-reopen'];
  } finally {
    await page.evaluate(() => window.unmountDimensionInputs?.());
    await page.close();
  }
}
