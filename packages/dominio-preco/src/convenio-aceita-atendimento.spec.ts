import { describe, expect, it } from 'vitest';
import { convenioAceitaAtendimento } from './convenio-aceita-atendimento.js';

describe('convênio suspenso bloqueia novos atendimentos no novo (regra 11)', () => {
  it('ativo aceita; suspenso e desconhecido não', () => {
    expect(convenioAceitaAtendimento({ codigo: 10, situacao: 'A' })).toEqual({ aceita: true, motivo: null });
    expect(convenioAceitaAtendimento({ codigo: 315, situacao: 'I ' }).aceita).toBe(false);
    expect(convenioAceitaAtendimento({ codigo: 315, situacao: 'I' }).motivo).toMatch(/suspenso/);
    expect(convenioAceitaAtendimento({ codigo: 7, situacao: null }).motivo).toMatch(/desconhecida/);
    expect(convenioAceitaAtendimento(null).aceita).toBe(false);
  });
});
