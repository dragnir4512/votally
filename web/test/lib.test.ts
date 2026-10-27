import { describe, expect, it } from 'vitest';
import { distribute, formatXaf, sanitizeColor, validPhone } from '../lib/format';
import { dictionaries, makeT } from '../lib/i18n';

describe('format', () => {
  it('répartit les votes sur les candidats', () => {
    expect(distribute(10, 3)).toEqual([4, 3, 3]);
    expect(distribute(5, 1)).toEqual([5]);
    expect(distribute(2, 3)).toEqual([]);          // pas assez de votes pour 3 candidats
  });
  it('valide les numéros camerounais et internationaux', () => {
    for (const ok of ['690000000', '6 90 00 00 00', '+237690000000', '237690000000', '222123456', '+33612345678']) expect(validPhone(ok), ok).toBe(true);
    for (const bad of ['', '12345', '790000000', '69000000', 'abcdefghi']) expect(validPhone(bad), bad).toBe(false);
  });
  it('n\'accepte que des couleurs hexadécimales (pas d\'injection CSS)', () => {
    expect(sanitizeColor('#0E7C66', '#000')).toBe('#0E7C66');
    expect(sanitizeColor('red; background:url(x)', '#000')).toBe('#000');
    expect(sanitizeColor(undefined, '#123')).toBe('#123');
  });
  it('formate les montants en FCFA', () => { expect(formatXaf(1025, 'en')).toBe('1,025 FCFA'); expect(formatXaf(1025, 'fr')).toMatch(/^1.025 FCFA$/); });
});

describe('i18n', () => {
  it('FR et EN ont exactement les mêmes clés (y compris les erreurs)', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.fr).sort());
    expect(Object.keys(dictionaries.en.errors).sort()).toEqual(Object.keys(dictionaries.fr.errors).sort());
  });
  it('remplace les variables et traduit les codes d\'erreur', () => {
    const { t, err } = makeT('fr');
    expect(t('voteFor', { n: 2 })).toBe('Voter pour 2 candidat(s)');
    expect(err('invalid_code')).toBe('Code incorrect ou expiré.');
    expect(err('business_rule', 'Quota atteint')).toBe('Quota atteint');
    expect(err('inconnu')).toBe(dictionaries.fr.genericError);
  });
});
