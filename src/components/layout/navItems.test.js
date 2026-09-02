import { describe, expect, it } from 'vitest';

import { NAV_GROUPS, activeGroupKey, isItemActive, visibleNavGroups } from './navItems.js';

const groups = [
  {
    key: 'operativo',
    label: 'Operar',
    items: [
      { path: '/resumen', label: 'Resumen', permission: 'dashboard' },
      { path: '/cxc', label: 'CXC', permission: 'cxc' },
      { path: '/cxc/remesas', label: 'Remesas', permission: 'cxc' },
    ],
  },
  {
    key: 'reportes',
    label: 'Ver',
    items: [{ path: '/reportes', label: 'Reportes', permission: 'reports' }],
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    items: [{ path: '/configuracion', label: 'Config', permission: 'settings' }],
  },
];

describe('NAV_GROUPS', () => {
  it('names the four groups by routine, in order', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Operar', 'Ver', 'Maestros', 'Configuración']);
    expect(NAV_GROUPS.map((group) => group.key)).toEqual(['operativo', 'reportes', 'maestros', 'configuracion']);
  });
});

describe('isItemActive', () => {
  const cxc = { path: '/cxc' };

  it('matches the exact path', () => {
    expect(isItemActive('/cxc', cxc)).toBe(true);
  });

  it('matches a nested route on a path boundary', () => {
    expect(isItemActive('/cxc/remesas', cxc)).toBe(true);
    expect(isItemActive('/cxc/remesas/', cxc)).toBe(true);
  });

  it('does not match a sibling that merely shares the prefix', () => {
    expect(isItemActive('/cxcx', cxc)).toBe(false);
    expect(isItemActive('/cxp', cxc)).toBe(false);
  });

  it('ignores query strings and hashes', () => {
    expect(isItemActive('/cxc?tab=open#top', cxc)).toBe(true);
  });

  it('is false for an unrelated or missing path', () => {
    expect(isItemActive('/resumen', cxc)).toBe(false);
    expect(isItemActive('/cxc', {})).toBe(false);
    expect(isItemActive(undefined, cxc)).toBe(false);
  });
});

describe('activeGroupKey', () => {
  it('returns the group holding the longest matching path prefix', () => {
    expect(activeGroupKey('/cxc/remesas', groups)).toBe('operativo');
    expect(activeGroupKey('/reportes', groups)).toBe('reportes');
    expect(activeGroupKey('/configuracion', groups)).toBe('configuracion');
  });

  it('defaults to operativo for routes that no item owns', () => {
    expect(activeGroupKey('/', groups)).toBe('operativo');
    expect(activeGroupKey('/perfil', groups)).toBe('operativo');
    expect(activeGroupKey('/reportes', [])).toBe('operativo');
  });

  it('uses the real groups by default', () => {
    expect(activeGroupKey('/empleados')).toBe('maestros');
    expect(activeGroupKey('/reglas')).toBe('configuracion');
    expect(activeGroupKey('/clasificar')).toBe('operativo');
  });
});

describe('visibleNavGroups', () => {
  it('keeps only the items the user may open and drops empty groups', () => {
    const visible = visibleNavGroups((section) => section === 'dashboard' || section === 'reports', groups);

    expect(visible.map((group) => group.key)).toEqual(['operativo', 'reportes']);
    expect(visible[0].items.map((item) => item.path)).toEqual(['/resumen']);
  });

  it('keeps items with no permission requirement', () => {
    const open = [{ key: 'x', label: 'X', items: [{ path: '/perfil', label: 'Perfil' }] }];
    expect(visibleNavGroups(() => false, open)[0].items).toHaveLength(1);
  });

  it('returns nothing when the permission check is missing', () => {
    expect(visibleNavGroups(undefined, groups)).toEqual([]);
  });

  it('does not mutate the source groups', () => {
    const before = JSON.stringify(groups);
    visibleNavGroups(() => false, groups);
    expect(JSON.stringify(groups)).toBe(before);
  });
});
