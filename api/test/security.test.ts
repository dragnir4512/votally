import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { normalizePhone } from '../src/security';

const app = createApp();

describe('Durcissement sécurité HTTP et authentification', () => {
  it('normalise les numéros camerounais et rejette les formats invalides', () => {
    expect(normalizePhone('691 234 567')).toBe('+237691234567');
    expect(normalizePhone('+237 691-234-567')).toBe('+237691234567');
    expect(() => normalizePhone('bonjour')).toThrow();
  });

  it('refuse une origine web non autorisée sur une requête de modification', async () => {
    const response = await request(app).post('/auth/login')
      .set('Origin', 'https://site-malveillant.example')
      .send({ email: 'test@example.com', password: 'Motdepasse1' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('origin_not_allowed');
  });

  it('accepte une origine configurée et valide le format du code OTP sur 6 chiffres', async () => {
    const response = await request(app).post('/auth/verify')
      .set('Origin', 'http://localhost:3001')
      .send({ email: 'test@example.com', code: '12AB56' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation');
  });

  it('refuse un mot de passe trop court même s’il contient majuscule et chiffre', async () => {
    const response = await request(app).post('/auth/register')
      .send({ email: 'short-password@example.com', password: 'Abcdefg1', fullName: 'Test User', acceptTerms: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation');
  });

  it('valide aussi strictement le format OTP lors de la réinitialisation', async () => {
    const response = await request(app).post('/auth/password/reset')
      .send({ email: 'test@example.com', code: '12345x', newPassword: 'NouveauMotdepasse1' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation');
  });
});
