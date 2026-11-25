// Porta de e-mail da entrada: o canal do dono (decisão do dono, 24/11/2026) só entrega ao e-mail do dono, só fora de
// produção e só com ACESSO_EMAIL_CANAL_DONO=sim; os demais destinatários seguem a regra 6 (captura local ou recusa).
import { describe, expect, it } from 'vitest';
import { emailAcessoDoAmbiente, emailDoDono, envioPeloCanalDoDono } from './email-acesso.js';

const MSG = { assunto: 'Recuperar a senha', texto: 'link de uso único' };

describe('canal do dono na porta de e-mail', () => {
  it('o e-mail do dono vem só de DONO_EMAIL; sem ele (ou vazio), null', () => {
    expect(emailDoDono({ DONO_EMAIL: ' Dono@Exemplo.dev ' })).toBe('dono@exemplo.dev');
    expect(emailDoDono({})).toBeNull();
    expect(emailDoDono({ DONO_EMAIL: '' })).toBeNull();
  });

  it('sem DONO_EMAIL o canal recusa qualquer envio', async () => {
    const porta = envioPeloCanalDoDono({}, '/inexistente');
    await expect(porta.enviar({ para: 'dono@exemplo.dev', ...MSG })).rejects.toThrow(
      'canal do dono desligado',
    );
  });

  it('ligado com DONO_EMAIL vazio: comportamento normal (sem SMTP_URL, sem envio)', () => {
    expect(
      emailAcessoDoAmbiente({ AMBIENTE: 'dev', ACESSO_EMAIL_CANAL_DONO: 'sim', DONO_EMAIL: '' }),
    ).toBeNull();
    expect(emailAcessoDoAmbiente({ AMBIENTE: 'dev', ACESSO_EMAIL_CANAL_DONO: 'sim' })).toBeNull();
  });

  it('o canal recusa outro destinatário sem chamar o envio', async () => {
    const porta = envioPeloCanalDoDono({ DONO_EMAIL: 'dono@exemplo.dev' }, '/inexistente');
    await expect(porta.enviar({ para: 'outra@exemplo.dev', ...MSG })).rejects.toThrow(
      'só entrega ao e-mail do dono',
    );
  });

  it('ligado e sem SMTP: outro destinatário é recusado (nada sai do ambiente)', async () => {
    const porta = emailAcessoDoAmbiente({
      AMBIENTE: 'dev',
      ACESSO_EMAIL_CANAL_DONO: 'sim',
      DONO_EMAIL: 'dono@exemplo.dev',
      SGH_RAIZ_REPOSITORIO: '/inexistente',
    });
    expect(porta).not.toBeNull();
    await expect(porta!.enviar({ para: 'paciente@exemplo.dev', ...MSG })).rejects.toThrow(
      'só o e-mail do dono',
    );
  });

  it('em produção o canal não existe: sem SMTP_URL a porta é nula', () => {
    expect(
      emailAcessoDoAmbiente({
        AMBIENTE: 'producao',
        ACESSO_EMAIL_CANAL_DONO: 'sim',
        DONO_EMAIL: 'dono@exemplo.dev',
      }),
    ).toBeNull();
  });

  it('desligado: comportamento antigo (sem SMTP_URL, sem envio)', () => {
    expect(emailAcessoDoAmbiente({ AMBIENTE: 'dev' })).toBeNull();
  });
});
