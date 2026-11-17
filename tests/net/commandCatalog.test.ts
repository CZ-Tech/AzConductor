import { describe, expect, it } from 'vitest';
import {
  DecodeError, decodeCommandCatalog,
  type CommandDescriptor, type CommandParameterSignature,
} from '../../src/net/models';

function signature(paramNames: string[], paramTypes: string[], paramDefaults: (string | null)[] = paramNames.map(() => null)): CommandParameterSignature {
  return { paramNames, paramTypes, paramDefaults };
}

function optional(defaultValue: string | null = null): CommandDescriptor {
  return {
    name: 'intaker.intakerIn', paramNames: ['power'], paramTypes: ['double'], paramDefaults: [defaultValue],
    signatures: [signature([], []), signature(['power'], ['double'], [defaultValue])],
    acceptedArgCounts: [0, 1], hasUnifiedSignature: true, requiredParamCount: 0, paramRequired: [false],
  };
}

function different(): CommandDescriptor {
  return {
    name: 'different', paramNames: ['count', 'power', 'label'], paramTypes: ['int', 'double', 'String'], paramDefaults: [null, '0.8', ''],
    signatures: [signature(['enabled'], ['boolean']), signature(['count', 'power', 'label'], ['int', 'double', 'String'], [null, '0.8', ''])],
    acceptedArgCounts: [1, 3], hasUnifiedSignature: false, requiredParamCount: null, paramRequired: null,
  };
}

const decode = (command: unknown) => decodeCommandCatalog({ revision: 7, commands: [command] }).commands[0];

describe('command catalog overload metadata', () => {
  it.each([null, '0.8', ''])('accepts 0/1 overloads with default %j without inferring requiredness from it', (defaultValue) => {
    const command = optional(defaultValue);
    expect(decode(command)).toEqual(command);
  });

  it('derives required flags from minimum arity, even for known defaults and unknown optional defaults', () => {
    const command: CommandDescriptor = {
      name: 'move', paramNames: ['count', 'power', 'label'], paramTypes: ['int', 'double', 'String'], paramDefaults: ['1', null, ''],
      signatures: [
        signature(['count'], ['int'], ['1']),
        signature(['count', 'power'], ['int', 'double'], ['1', null]),
        signature(['count', 'power', 'label'], ['int', 'double', 'String'], ['1', null, '']),
      ],
      acceptedArgCounts: [1, 2, 3], hasUnifiedSignature: true, requiredParamCount: 1, paramRequired: [true, false, false],
    };
    expect(decode(command)).toEqual(command);
  });

  it('does not use defaults to decide whether matching prefixes unify', () => {
    const command: CommandDescriptor = {
      name: 'defaults', paramNames: ['a', 'b'], paramTypes: ['int', 'int'], paramDefaults: ['2', '3'],
      signatures: [signature(['a'], ['int'], ['1']), signature(['a', 'b'], ['int', 'int'], ['2', '3'])],
      acceptedArgCounts: [1, 2], hasUnifiedSignature: true, requiredParamCount: 1, paramRequired: [true, false],
    };
    expect(decode(command)).toEqual(command);
  });

  it('accepts a single no-argument signature', () => {
    const command: CommandDescriptor = {
      name: 'stop', ...signature([], []), signatures: [signature([], [])],
      acceptedArgCounts: [0], hasUnifiedSignature: true, requiredParamCount: 0, paramRequired: [],
    };
    expect(decode(command)).toEqual(command);
  });

  it('preserves explicit null required metadata for gaps and changed names/types', () => {
    expect(decode(different())).toEqual(different());
    const gap: CommandDescriptor = {
      name: 'gap', ...signature(['a', 'b'], ['int', 'int']),
      signatures: [signature([], []), signature(['a', 'b'], ['int', 'int'])],
      acceptedArgCounts: [0, 2], hasUnifiedSignature: false, requiredParamCount: null, paramRequired: null,
    };
    expect(decode(gap)).toEqual(gap);
    for (const short of [signature(['other'], ['int']), signature(['a'], ['boolean'])]) {
      const changed: CommandDescriptor = {
        ...gap, signatures: [short, signature(['a', 'b'], ['int', 'int'])], acceptedArgCounts: [1, 2],
      };
      expect(decode(changed)).toEqual(changed);
    }
  });

  it('keeps the old firmware decoder behavior when all new fields are absent', () => {
    expect(decode({ name: 'old', paramNames: ['a', 'b'], paramTypes: ['int', 'String'] }))
      .toEqual({ name: 'old', paramNames: ['a', 'b'], paramTypes: ['int', 'String'], paramDefaults: [null, null] });
    expect(decode({ name: 'old', paramNames: ['a', 'b'], paramTypes: ['int', 'String'], paramDefaults: ['3'] }))
      .toEqual({ name: 'old', paramNames: ['a', 'b'], paramTypes: ['int', 'String'], paramDefaults: ['3', null] });
    expect(decode({ name: 'old', paramNames: ['a'], paramTypes: [], paramDefaults: [null, 'ignored'] }))
      .toEqual({ name: 'old', paramNames: ['a'], paramTypes: [], paramDefaults: [null] });
  });

  const keys = ['signatures', 'acceptedArgCounts', 'hasUnifiedSignature', 'requiredParamCount', 'paramRequired'] as const;
  for (const key of keys) {
    it(`rejects a new metadata group missing ${key}`, () => {
      const command = optional();
      delete command[key];
      expect(() => decode(command)).toThrow(DecodeError);
    });
    it(`rejects ${key} on its own rather than treating a partial group as legacy`, () => {
      const command = optional();
      for (const other of keys) if (other !== key) delete command[other];
      expect(() => decode(command)).toThrow(DecodeError);
    });
    it(`rejects undefined ${key} even if the property exists`, () => {
      expect(() => decode({ ...optional(), [key]: undefined })).toThrow(DecodeError);
    });
  }

  const invalid: [string, (command: CommandDescriptor) => void][] = [
    ['empty signatures', (c) => { c.signatures = []; }],
    ['duplicate arity', (c) => { c.signatures = [signature([], []), signature([], []), signature(['power'], ['double'])]; }],
    ['unsorted signatures', (c) => { c.signatures?.reverse(); }],
    ['missing signature type', (c) => { c.signatures![1]!.paramTypes = []; }],
    ['missing signature default', (c) => { c.signatures![1]!.paramDefaults = []; }],
    ['extra signature default', (c) => { c.signatures![1]!.paramDefaults.push('2'); }],
    ['wrong base name', (c) => { c.paramNames[0] = 'forged'; }],
    ['wrong base type', (c) => { c.paramTypes[0] = 'boolean'; }],
    ['wrong base default', (c) => { c.paramDefaults[0] = '0.5'; }],
    ['wrong base dimensions', (c) => { c.paramTypes = []; }],
    ['missing accepted arity', (c) => { c.acceptedArgCounts = [1]; }],
    ['duplicate accepted arity', (c) => { c.acceptedArgCounts = [0, 0, 1]; }],
    ['unsorted accepted arities', (c) => { c.acceptedArgCounts = [1, 0]; }],
    ['fractional accepted arity', (c) => { c.acceptedArgCounts = [0, 0.5]; }],
    ['false unified flag', (c) => { c.hasUnifiedSignature = false; c.requiredParamCount = null; c.paramRequired = null; }],
    ['wrong required count', (c) => { c.requiredParamCount = 1; }],
    ['null required count for unified', (c) => { c.requiredParamCount = null; }],
    ['wrong required flags', (c) => { c.paramRequired = [true]; }],
    ['wrong required flag dimensions', (c) => { c.paramRequired = []; }],
    ['null flags for unified', (c) => { c.paramRequired = null; }],
  ];
  it.each(invalid)('rejects inconsistent metadata: %s', (_, mutate) => {
    const command = optional();
    mutate(command);
    expect(() => decode(command)).toThrow(DecodeError);
  });

  it.each([
    { signatures: null }, { signatures: [null] },
    { signatures: [{ paramNames: [], paramTypes: [] }] },
    { signatures: [signature([], []), { paramNames: ['power'], paramTypes: ['double'], paramDefaults: [false] }] },
    { signatures: [signature([], []), { paramNames: [1], paramTypes: ['double'], paramDefaults: [null] }] },
    { signatures: [signature([], []), { paramNames: ['power'], paramTypes: [1], paramDefaults: [null] }] },
    { acceptedArgCounts: ['0', '1'] }, { hasUnifiedSignature: 'true' },
    { requiredParamCount: '0' }, { paramRequired: [0] },
    { paramNames: null }, { paramTypes: null }, { paramDefaults: null },
    { signatures: new Array(2) }, { paramNames: new Array(1) },
    { paramTypes: new Array(1) }, { paramDefaults: new Array(1) },
    { acceptedArgCounts: new Array(2) }, { paramRequired: new Array(1) },
  ])('rejects malformed new field values %j', (override) => {
    expect(() => decode({ ...optional(), ...override })).toThrow(DecodeError);
  });

  it('requires full base arrays for new firmware rather than legacy padding', () => {
    for (const key of ['paramNames', 'paramTypes', 'paramDefaults'] as const) {
      const command: Partial<CommandDescriptor> = optional();
      delete command[key];
      expect(() => decode(command)).toThrow(DecodeError);
    }
  });

  it('rejects forged optional flags for gaps, renamed parameters, or changed parameter types', () => {
    const gap = different();
    for (const command of [
      gap,
      { ...gap, signatures: [signature(['other'], ['int']), signature(['a', 'b'], ['int', 'int'])], paramNames: ['a', 'b'], paramTypes: ['int', 'int'], paramDefaults: [null, null], acceptedArgCounts: [1, 2] },
      { ...gap, signatures: [signature(['a'], ['boolean']), signature(['a', 'b'], ['int', 'int'])], paramNames: ['a', 'b'], paramTypes: ['int', 'int'], paramDefaults: [null, null], acceptedArgCounts: [1, 2] },
    ]) {
      expect(() => decode({ ...command, hasUnifiedSignature: true, requiredParamCount: 1, paramRequired: command.paramNames.map((_, i) => i === 0) })).toThrow(DecodeError);
      expect(() => decode({ ...command, requiredParamCount: 1 })).toThrow(DecodeError);
      expect(() => decode({ ...command, paramRequired: command.paramNames.map(() => false) })).toThrow(DecodeError);
    }
  });

  it('does not let known defaults forge optionality when no short signature exists', () => {
    const command: CommandDescriptor = {
      name: 'required', ...signature(['power'], ['double'], ['0.8']),
      signatures: [signature(['power'], ['double'], ['0.8'])], acceptedArgCounts: [1],
      hasUnifiedSignature: true, requiredParamCount: 1, paramRequired: [true],
    };
    expect(decode(command)).toEqual(command);
    expect(() => decode({ ...command, requiredParamCount: 0, paramRequired: [false] })).toThrow(DecodeError);
  });

  it('copies base, nested signatures, counts and flags without reusing mutable input', () => {
    const raw = optional('0.8');
    const expected = structuredClone(raw);
    const decoded = decode(raw)!;
    expect(decoded.paramNames).not.toBe(raw.paramNames);
    expect(decoded.paramTypes).not.toBe(raw.paramTypes);
    expect(decoded.paramDefaults).not.toBe(raw.paramDefaults);
    expect(decoded.signatures).not.toBe(raw.signatures);
    expect(decoded.signatures![1]).not.toBe(raw.signatures![1]);
    expect(decoded.signatures![1]!.paramNames).not.toBe(raw.signatures![1]!.paramNames);
    expect(decoded.signatures![1]!.paramTypes).not.toBe(raw.signatures![1]!.paramTypes);
    expect(decoded.signatures![1]!.paramDefaults).not.toBe(raw.signatures![1]!.paramDefaults);
    expect(decoded.acceptedArgCounts).not.toBe(raw.acceptedArgCounts);
    expect(decoded.paramRequired).not.toBe(raw.paramRequired);
    raw.paramNames[0] = 'changed';
    raw.paramTypes[0] = 'boolean';
    raw.paramDefaults[0] = 'bad';
    raw.signatures![1]!.paramNames[0] = 'other';
    raw.signatures![1]!.paramTypes[0] = 'String';
    raw.signatures![1]!.paramDefaults[0] = 'other';
    raw.acceptedArgCounts!.push(2);
    raw.paramRequired![0] = true;
    expect(decoded).toEqual(expected);
    decoded.signatures![1]!.paramNames[0] = 'also changed';
    expect(decoded.paramNames).toEqual(['power']);
  });
});
