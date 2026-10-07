'use strict';

import * as assert from 'assert';
import * as path from 'path';
import { getOperatingSystemDescription } from '../projectinfo';
import { getWPILibHomeDirForPlatform, getWPILibYear } from '../shared/utilitiesapi';

suite('Utilities API Tests', () => {
  const year = getWPILibYear();
  const homeDir = path.join(path.sep, 'home', 'testuser');
  const xdgDataHome = path.join(path.sep, 'xdg', 'data');

  test('macOS WPILib home uses hidden home folder', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('darwin', homeDir, {}),
      path.join(homeDir, '.wpilib', year)
    );
  });

  test('Linux WPILib home uses XDG_DATA_HOME when set', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('linux', homeDir, { XDG_DATA_HOME: xdgDataHome }),
      path.join(xdgDataHome, 'wpilib', year)
    );
  });

  test('Linux WPILib home falls back to XDG default data folder', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('linux', homeDir, {}),
      path.join(homeDir, '.local', 'share', 'wpilib', year)
    );
  });

  test('Linux WPILib home falls back to XDG default data folder when XDG_DATA_HOME is a local path', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('linux', homeDir, { XDG_DATA_HOME: 'local/path' }),
      path.join(homeDir, '.local', 'share', 'wpilib', year)
    );
  });

  test('Linux WPILib home ignores empty XDG_DATA_HOME', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('linux', homeDir, { XDG_DATA_HOME: '' }),
      path.join(homeDir, '.local', 'share', 'wpilib', year)
    );
  });

  test('Windows WPILib home still uses public folder', () => {
    assert.strictEqual(
      getWPILibHomeDirForPlatform('win32', homeDir, { PUBLIC: 'C:\\Users\\Public' }),
      path.join('C:\\Users\\Public', 'wpilib', year)
    );
  });

  test('Operating system description includes platform and release', () => {
    assert.strictEqual(getOperatingSystemDescription('win32', '10.0.26100'), 'Windows 10.0.26100');
    assert.strictEqual(getOperatingSystemDescription('linux', '6.8.0'), 'Linux 6.8.0');
    assert.strictEqual(getOperatingSystemDescription('darwin', '23.4.0'), 'macOS 23.4.0');
  });
});
