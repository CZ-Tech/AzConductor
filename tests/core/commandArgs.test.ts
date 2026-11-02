import { describe, expect, it } from 'vitest';
import { argError, argsValid, draftArgs, paramKind, resolveArgs, validateArg } from '../../src/core/commandArgs';
import { decodeCommandCatalog } from '../../src/net/models';

describe('paramKind', () => {
  it('maps the type names the firmware converts (case-sensitive, optional java.lang.)', () => {
    for (const t of ['int', 'Integer', 'long', 'Long', 'short', 'Short', 'byte', 'Byte', 'java.lang.Integer']) expect(paramKind(t)).toBe('integer');
    for (const t of ['double', 'Double', 'float', 'Float']) expect(paramKind(t)).toBe('number');
    for (const t of ['boolean', 'Boolean']) expect(paramKind(t)).toBe('boolean');
    for (const t of ['char', 'Character']) expect(paramKind(t)).toBe('char');
  });

  it('treats everything else as free text, as the firmware does', () => {
    for (const t of ['String', 'SomeEnum', 'Int', 'number', 'bool', undefined]) expect(paramKind(t)).toBe('text');
  });
});

describe('validateArg', () => {
  it('reports blank values as missing unless a text parameter has a default', () => {
    for (const t of ['int', 'double', 'boolean', 'char', 'String']) {
      expect(validateArg(t, '')).toBe('missing');
      expect(validateArg(t, '   ')).toBe('missing');
    }
    expect(validateArg('String', '', true)).toBeNull();
    expect(validateArg('int', '', true)).toBe('missing');
  });

  it('accepts what Integer.valueOf accepts (after trimming) and nothing else', () => {
    for (const v of ['3', '-3', '+3', ' 7 ']) expect(validateArg('int', v)).toBeNull();
    for (const v of ['1.5', '1e3', '0x10', '1 2']) expect(validateArg('int', v)).toBe('integer');
  });

  it('checks the range of each integer type', () => {
    expect(validateArg('int', '2147483647')).toBeNull();
    expect(validateArg('int', '2147483648')).toBe('range');
    expect(validateArg('int', '-2147483649')).toBe('range');
    expect(validateArg('long', '9223372036854775807')).toBeNull();
    expect(validateArg('Long', '9223372036854775808')).toBe('range');
    expect(validateArg('short', '32768')).toBe('range');
    expect(validateArg('byte', '127')).toBeNull();
    expect(validateArg('Byte', '128')).toBe('range');
  });

  it('accepts decimals and exponents but not Number()-only or non-finite forms', () => {
    for (const v of ['0.8', '-.5', '5.', '1e-3', ' 2 ']) expect(validateArg('double', v)).toBeNull();
    for (const v of ['0x10', 'Infinity', 'NaN', '1,5']) expect(validateArg('double', v)).toBe('number');
    expect(validateArg('double', '1e999')).toBe('range');
    expect(validateArg('double', '1e39')).toBeNull();
    expect(validateArg('float', '1e39')).toBe('range'); // overflows a float
  });

  it('char needs exactly one UTF-16 unit', () => {
    expect(validateArg('char', 'a')).toBeNull();
    expect(validateArg('char', '蓝')).toBeNull();
    expect(validateArg('char', 'ab')).toBe('char');
    expect(validateArg('char', '😀')).toBe('char'); // two UTF-16 units: the firmware refuses it
  });
});

describe('draftArgs / resolveArgs / argsValid', () => {
  const shoot = { paramNames: ['count', 'power', 'hold'], paramTypes: ['int', 'double', 'boolean'] };
  const spin = {
    paramNames: ['rpm', 'power', 'reverse', 'label'], paramTypes: ['int', 'double', 'boolean', 'String'],
    paramDefaults: [null, '0.8', 'TRUE', ''] as (string | null)[],
  };

  it('pre-fills catalog defaults, keeps entered values and follows a changed signature', () => {
    expect(draftArgs(shoot)).toEqual(['', '', 'false']);
    expect(draftArgs(spin)).toEqual(['', '0.8', 'true', '']);
    expect(draftArgs(spin, ['900', '0.5'])).toEqual(['900', '0.5', 'true', '']);
    expect(draftArgs({ paramNames: ['a'], paramTypes: ['int'] }, ['1', '2'])).toEqual(['1']);
  });

  it('always resolves to one value per parameter: blank → default, numbers trimmed, text untouched', () => {
    expect(resolveArgs(spin, ['900', '', '', ''])).toEqual(['900', '0.8', 'TRUE', '']);
    expect(resolveArgs(spin, [' 900 ', ' 0.5 ', 'false', ' hi '])).toEqual(['900', '0.5', 'false', ' hi ']);
    expect(resolveArgs(spin, ['900'])).toEqual(['900', '0.8', 'TRUE', '']); // short drafts are completed too
    expect(resolveArgs(spin, [])).toHaveLength(4);
    expect(resolveArgs({ paramNames: [], paramTypes: [] }, [])).toEqual([]);
  });

  it('a blank required parameter stays missing; a blank defaulted one is fine', () => {
    expect(argError(spin, 0, '')).toBe('missing');
    expect(argError(spin, 1, '')).toBeNull();
    expect(argError(spin, 1, 'abc')).toBe('number');
    expect(argsValid(spin, ['900', '', 'false', ''])).toBe(true);
    expect(argsValid(spin, ['', '', 'false', ''])).toBe(false);
    expect(argsValid(shoot, ['3', '0.8', 'true'])).toBe(true);
    expect(argsValid(shoot, ['3', '', 'true'])).toBe(false);
    expect(argsValid(shoot, ['3', '0.8'])).toBe(false); // a short draft leaves the default-less boolean empty: never sent incomplete
  });
});

describe('decodeCommandCatalog paramDefaults', () => {
  it('keeps defaults and always yields one entry per parameter', () => {
    const c = decodeCommandCatalog({ revision: 3, commands: [{ name: 'a.b', paramNames: ['x', 'y'], paramTypes: ['int', 'double'], paramDefaults: [null, '1.5'] }] });
    expect(c.commands[0]?.paramDefaults).toEqual([null, '1.5']);
  });

  it('older firmware without the field: every parameter is required', () => {
    const c = decodeCommandCatalog({ revision: 1, commands: [{ name: 'shoot', paramNames: ['n', 'p'], paramTypes: ['int', 'double'] }] });
    expect(c.commands[0]?.paramDefaults).toEqual([null, null]);
  });

  it('pads a short defaults list and refuses non-text defaults', () => {
    const c = decodeCommandCatalog({ revision: 1, commands: [{ name: 'a', paramNames: ['x', 'y'], paramTypes: ['int', 'int'], paramDefaults: ['1'] }] });
    expect(c.commands[0]?.paramDefaults).toEqual(['1', null]);
    expect(() => decodeCommandCatalog({ revision: 1, commands: [{ name: 'a', paramNames: ['x'], paramTypes: ['int'], paramDefaults: [1] }] })).toThrow();
  });
});
