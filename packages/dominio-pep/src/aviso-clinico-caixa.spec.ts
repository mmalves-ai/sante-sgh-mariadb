import { describe, expect, it } from 'vitest';
import {
  avisoClinicoNaCaixa,
  decidirCienciaAvisoClinico,
  type DestinatarioAvisoClinico,
  estadoDoAvisoClinico,
  gravidadeDoAvisoClinico,
  linkDoAvisoClinico,
  ordenarCaixaAvisosClinicos,
} from './aviso-clinico-caixa.js';

const d = (x: Partial<DestinatarioAvisoClinico> = {}): DestinatarioAvisoClinico => ({
  usuario: 7,
  situacaoAviso: 'pendente',
  situacaoDestinatario: 'pendente',
  lidoEm: null,
  cienteEm: null,
  excluido: false,
  ...x,
});

describe('caixa de avisos clínicos do destinatário', () => {
  it('o aviso cancelado, o envio cancelado e o excluído não aparecem', () => {
    expect(avisoClinicoNaCaixa(d())).toBe(true);
    expect(avisoClinicoNaCaixa(d({ situacaoAviso: 'cancelado' }))).toBe(false);
    expect(avisoClinicoNaCaixa(d({ situacaoDestinatario: 'cancelado' }))).toBe(false);
    expect(avisoClinicoNaCaixa(d({ excluido: true }))).toBe(false);
  });

  it('o estado vem do destinatário: novo, lido e ciente', () => {
    expect(estadoDoAvisoClinico(d())).toBe('novo');
    expect(estadoDoAvisoClinico(d({ lidoEm: new Date() }))).toBe('lido');
    expect(estadoDoAvisoClinico(d({ situacaoDestinatario: 'lido' }))).toBe('lido');
    expect(estadoDoAvisoClinico(d({ lidoEm: new Date(), cienteEm: new Date() }))).toBe('ciente');
    expect(estadoDoAvisoClinico(d({ situacaoDestinatario: 'ciente' }))).toBe('ciente');
  });

  it('a gravidade vem da prioridade, sem interromper a tarefa', () => {
    expect(gravidadeDoAvisoClinico('critica')).toBe('atencao');
    expect(gravidadeDoAvisoClinico('alta')).toBe('atencao');
    expect(gravidadeDoAvisoClinico('normal')).toBe('informacao');
    expect(gravidadeDoAvisoClinico('baixa')).toBe('informacao');
  });

  it('o link leva aos exames do paciente, só com o identificador', () => {
    expect(linkDoAvisoClinico({ paciente: 10, resultado: 3 })).toBe('/pep/paciente/10/exames');
    expect(linkDoAvisoClinico({ paciente: 10, resultado: null })).toBe('/pep/paciente/10');
    expect(linkDoAvisoClinico({ paciente: null, resultado: 3 })).toBeNull();
  });

  it('a ciência é só do próprio destinatário, nunca no cancelado, e a repetida não grava', () => {
    expect(decidirCienciaAvisoClinico(d(), 7)).toEqual({ gravar: true });
    expect(decidirCienciaAvisoClinico(d({ lidoEm: new Date() }), 7)).toEqual({ gravar: true });
    expect(decidirCienciaAvisoClinico(d(), 8)).toEqual({ recusa: 'aviso-de-outro-usuario' });
    expect(decidirCienciaAvisoClinico(d({ usuario: null }), 7)).toEqual({ recusa: 'aviso-de-outro-usuario' });
    expect(decidirCienciaAvisoClinico(d({ situacaoAviso: 'cancelado' }), 7)).toEqual({
      recusa: 'aviso-cancelado',
    });
    expect(decidirCienciaAvisoClinico(d({ cienteEm: new Date() }), 7)).toEqual({
      gravar: false,
      motivo: 'ja-ciente',
    });
  });

  it('ordena novos, lidos e cientes; o mais novo primeiro', () => {
    const r = ordenarCaixaAvisosClinicos([
      { id: 1, estado: 'ciente' as const, geradoEm: '2026-11-25T10:00:00' },
      { id: 2, estado: 'novo' as const, geradoEm: '2026-11-24T10:00:00' },
      { id: 3, estado: 'novo' as const, geradoEm: '2026-11-25T09:00:00' },
      { id: 4, estado: 'lido' as const, geradoEm: '2026-11-25T11:00:00' },
    ]);
    expect(r.map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
});
