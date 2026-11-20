// O aviso do valor crítico na central de avisos (revisão do M27): forma do aviso, destinatário e falha que não desfaz
// a liberação. Dados sintéticos.
import { esquemaNovoAviso, type NovoAviso } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { PortaSadt } from '../porta.js';
import { avisarCriticoNaCentral, avisoDoCritico, type CentralDeAvisos } from './central-critico.js';

const c = { rede: 'sintetica', hospital: 'aa' };
const autor = { login: 'SINT.BIOMEDICO', estacao: 'teste', correlacao: 'c-1' };
const porta = (login: string | null) =>
  ({ responsavelDoAtendimento: async () => login }) as unknown as PortaSadt;

function central(): CentralDeAvisos & { emitidos: NovoAviso[] } {
  const emitidos: NovoAviso[] = [];
  const chaves = new Set<string>();
  return {
    emitidos,
    async emitir(_c, _a, novo) {
      const k = `${novo.login}|${novo.evento}|${novo.objetoChave}`;
      if (chaves.has(k)) return null;
      chaves.add(k);
      emitidos.push(novo);
      return emitidos.length;
    },
  };
}

describe('aviso do valor crítico na central', () => {
  it('forma: válido pelo contrato, sem dado do paciente no título, link para os resultados', () => {
    const a = avisoDoCritico({ login: 'SINT.MEDICO', exame: 77, liberacao: 9, paciente: 1001 });
    expect(esquemaNovoAviso.parse(a)).toEqual(a);
    expect(a).toMatchObject({
      tipo: 'resultado-critico',
      gravidade: 'atencao',
      modulo: 'sadt',
      evento: 'sadt.avisoCritico.emitido',
      objetoTabela: 'SILANEXA',
      objetoChave: '77:9',
      link: '/pep/paciente/1001/resultados',
    });
    expect(a.titulo).not.toMatch(/1001/);
    expect(avisoDoCritico({ login: 'X', exame: 77, liberacao: null, paciente: 1 }).objetoChave).toBe('77');
  });

  it('vai ao médico do atendimento, uma vez por exame e liberação', async () => {
    const k = central();
    const x = { exame: 77, liberacao: 9, paciente: 1001, atendimento: 5 };
    expect(await avisarCriticoNaCentral(k, porta('SINT.MEDICO'), c, autor, x)).toBe(true);
    expect(await avisarCriticoNaCentral(k, porta('SINT.MEDICO'), c, autor, x)).toBe(false);
    expect(await avisarCriticoNaCentral(k, porta('SINT.MEDICO'), c, autor, { ...x, liberacao: 10 })).toBe(
      true,
    );
    expect(k.emitidos.map((a) => a.login)).toEqual(['SINT.MEDICO', 'SINT.MEDICO']);
  });

  it('sem central, sem atendimento ou sem médico com usuário, nada; a falha da central não lança', async () => {
    const x = { exame: 77, liberacao: 9, paciente: 1001, atendimento: 5 };
    expect(await avisarCriticoNaCentral(null, porta('SINT.MEDICO'), c, autor, x)).toBe(false);
    const k = central();
    expect(await avisarCriticoNaCentral(k, porta(null), c, autor, x)).toBe(false);
    expect(await avisarCriticoNaCentral(k, porta('SINT.MEDICO'), c, autor, { ...x, atendimento: null })).toBe(
      false,
    );
    expect(k.emitidos).toHaveLength(0);
    const quebrada: CentralDeAvisos = {
      emitir: async () => {
        throw new Error('banco fora');
      },
    };
    expect(await avisarCriticoNaCentral(quebrada, porta('SINT.MEDICO'), c, autor, x)).toBe(false);
  });
});
