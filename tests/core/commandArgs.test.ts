import { describe, expect, it } from 'vitest';
import { argError, argsValid, commandVariants, draftArgs, isOptionalParam, paramKind, resolveArgs, validateArg, variantForArgs, type CommandSignature } from '../../src/core/commandArgs';
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

function unified(names: string[], types: string[], counts: number[], defaults: (string | null)[] = names.map(() => null)): CommandSignature {
  const required = counts[0] ?? names.length;
  return {
    paramNames: names, paramTypes: types, paramDefaults: defaults,
    signatures: counts.map((count) => ({ paramNames: names.slice(0, count), paramTypes: types.slice(0, count), paramDefaults: defaults.slice(0, count) })),
    acceptedArgCounts: counts, hasUnifiedSignature: true, requiredParamCount: required,
    paramRequired: names.map((_, i) => i < required),
  };
}

describe('overload-aware command arguments', () => {
  const intake = unified(['power'], ['double'], [0, 1]);
  const chain = unified(['count', 'power', 'reverse'], ['int', 'double', 'boolean'], [1, 2, 3]);

  it('does not infer a default from a zero/one-argument overload', () => {
    expect(isOptionalParam(intake, 0)).toBe(true);
    expect(draftArgs(intake)).toEqual(['']);
    expect(argsValid(intake, [])).toBe(true);
    expect(argsValid(intake, [''])).toBe(true);
    expect(resolveArgs(intake, [''])).toEqual([]);
    expect(resolveArgs(intake, ['   '])).toEqual([]);
    expect(resolveArgs(intake, [' 0 '])).toEqual(['0']);
    expect(argsValid(intake, ['bad'])).toBe(false);
    expect(argError(intake, 0, '')).toBeNull();
    expect(argError(intake, 0, 'bad')).toBe('number');
  });

  it('initializes optional booleans as omitted, not false, while preserving explicit false', () => {
    const toggle = unified(['on'], ['boolean'], [0, 1]);
    expect(draftArgs(toggle)).toEqual(['']);
    expect(resolveArgs(toggle, [''])).toEqual([]);
    expect(resolveArgs(toggle, ['false'])).toEqual(['false']);
    expect(resolveArgs(toggle, [' TRUE '])).toEqual(['TRUE']);
    expect(argsValid(toggle, ['false'])).toBe(true);
    expect(argsValid(toggle, ['1'])).toBe(false);
    expect(validateArg('boolean', 'enabled')).toBe('boolean');
  });

  it('keeps required prefixes and omits only blank optional tails', () => {
    expect(draftArgs(chain)).toEqual(['', '', '']);
    expect(isOptionalParam(chain, 0)).toBe(false);
    expect(isOptionalParam(chain, 1)).toBe(true);
    expect(resolveArgs(chain, [' 3 ', '', ''])).toEqual(['3']);
    expect(resolveArgs(chain, ['3', '0.8', ''])).toEqual(['3', '0.8']);
    expect(argsValid(chain, ['3'])).toBe(true);
    expect(argsValid(chain, ['', '0.8'])).toBe(false);
    expect(argsValid(chain, ['3', '', 'true'])).toBe(false);
    expect(argError(chain, 1, '', ['3', '', 'true'])).toBe('missing');
    expect(argError(chain, 2, '', ['3', '', ''])).toBeNull();
  });

  it('uses only explicit defaults to bridge an interior hole, without extending a blank tail', () => {
    const defaults = unified(['count', 'power', 'reverse'], ['int', 'double', 'boolean'], [1, 2, 3], [null, '0.8', 'false']);
    expect(draftArgs(defaults)).toEqual(['', '', '']);
    expect(resolveArgs(defaults, ['3', '', ''])).toEqual(['3']);
    expect(resolveArgs(defaults, ['3', '', 'true'])).toEqual(['3', '0.8', 'true']);
    expect(argsValid(defaults, ['3', '', 'true'])).toBe(true);
    expect(argError(defaults, 1, '', ['3', '', 'true'])).toBeNull();
  });

  it('never shifts values across an unfillable optional hole or drops extra arguments', () => {
    expect(resolveArgs(chain, ['3', '', 'false'])).toEqual(['3', '', 'false']);
    expect(argsValid(chain, ['3', '', 'false'])).toBe(false);
    expect(argsValid(chain, ['3', '0.8', 'true', 'extra'])).toBe(false);
    expect(argsValid(chain, ['3', '0.8', 'true', ''])).toBe(false);
  });

  it('keeps independent signatures and validates the short overload using its own types', () => {
    const command: CommandSignature = {
      paramNames: ['count', 'power', 'label'], paramTypes: ['int', 'double', 'String'], paramDefaults: [null, null, null],
      signatures: [
        { paramNames: ['enabled'], paramTypes: ['boolean'], paramDefaults: [null] },
        { paramNames: ['count', 'power', 'label'], paramTypes: ['int', 'double', 'String'], paramDefaults: [null, null, null] },
      ],
      acceptedArgCounts: [1, 3], hasUnifiedSignature: false, requiredParamCount: null, paramRequired: null,
    };
    const variants = commandVariants(command);
    expect(variants).toHaveLength(2);
    expect(variants[0]?.paramNames).toEqual(['enabled']);
    expect(variants[0]?.paramRequired).toEqual([true]);
    expect(variantForArgs(command, ['true'])).toBe(0);
    expect(variantForArgs(command, ['3', '0.8'])).toBe(-1);
    expect(variantForArgs(command, ['3', '0.8', 'name'])).toBe(1);
    expect(argsValid(command, ['true'])).toBe(true);
    expect(argsValid(command, ['3'])).toBe(false);
    expect(argsValid(command, ['3', '0.8'])).toBe(false);
    expect(argsValid(command, ['3', '0.8', ' name '])).toBe(true);
    expect(resolveArgs(command, [' true '])).toEqual(['true']);
    expect(resolveArgs(command, ['3', '0.8', ' name '])).toEqual(['3', '0.8', ' name ']);
    // Invalid saved nodes are left intact for the user to fix, not truncated to another overload.
    expect(resolveArgs(command, ['3', '0.8'])).toEqual(['3', '0.8']);
  });

  it('requires every field of a selected exact signature, even if other overloads are shorter', () => {
    const exact = commandVariants({ ...chain, hasUnifiedSignature: false })[2]!;
    expect(exact.requiredParamCount).toBe(3);
    expect(argsValid(exact, ['3'])).toBe(false);
    expect(argsValid(exact, ['3', '0.8', 'false'])).toBe(true);
  });

  it('retains legacy required/defaulted behavior when overload metadata is absent', () => {
    const legacy = { paramNames: ['rpm', 'power'], paramTypes: ['int', 'double'], paramDefaults: [null, '0.8'] };
    expect(commandVariants(legacy)).toEqual([legacy]);
    expect(variantForArgs(legacy, [])).toBe(0);
    expect(draftArgs(legacy)).toEqual(['', '0.8']);
    expect(resolveArgs(legacy, ['900', ''])).toEqual(['900', '0.8']);
    expect(argsValid(legacy, ['900'])).toBe(true);
    expect(argError({ ...legacy, paramDefaults: [null, 'bad'] }, 1, '')).toBe('number');
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
