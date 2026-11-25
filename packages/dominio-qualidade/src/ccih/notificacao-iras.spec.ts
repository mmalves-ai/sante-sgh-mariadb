import { describe, expect, it } from 'vitest';
import {
  avaliarAndamentoIras,
  avaliarEnvioIras,
  envioAtrasado,
  fimDaCompetencia,
  formularioDoComponente,
  prazoDoEnvio,
  situacaoDosFormularios,
} from './notificacao-iras.js';

const base = { competencia: '2026-02', situacaoCompetencia: 'fechada', anteriores: [], hoje: '2026-03-10' };
const entrada = {
  formulario: 'uti_adulto',
  situacao: 'transcrita' as const,
  enviadoEm: '2026-03-05',
  protocolo: 'P-1',
  motivoRetificacao: null,
};

describe('envio da notificação de IRAS ao órgão sanitário', () => {
  it('calcula o fim da competência e o prazo (dia 15 do mês seguinte, virando o ano)', () => {
    expect(fimDaCompetencia('2026-02')).toBe('2026-02-28');
    expect(fimDaCompetencia('2028-02')).toBe('2028-02-29');
    expect(prazoDoEnvio('2026-02')).toBe('2026-03-15');
    expect(prazoDoEnvio('2026-12')).toBe('2027-01-15');
  });

  it('o primeiro envio do formulário é o inicial; o seguinte é retificação e exige o motivo', () => {
    expect(avaliarEnvioIras(entrada, base)).toEqual({ recusa: null, tipo: 'inicial' });
    const anteriores = [{ formulario: 'uti_adulto', situacao: 'aceita' as const }];
    expect(avaliarEnvioIras(entrada, { ...base, anteriores })).toEqual({
      recusa: 'motivo-retificacao',
      tipo: 'retificacao',
    });
    expect(
      avaliarEnvioIras({ ...entrada, motivoRetificacao: 'Corrigido o denominador' }, { ...base, anteriores }),
    ).toEqual({ recusa: null, tipo: 'retificacao' });
    // Outro formulário segue inicial.
    expect(avaliarEnvioIras({ ...entrada, formulario: 'cirurgia' }, { ...base, anteriores }).tipo).toBe(
      'inicial',
    );
  });

  it('recusa competência aberta, formulário fora da lista e envio pendente em aberto', () => {
    expect(avaliarEnvioIras(entrada, { ...base, situacaoCompetencia: 'aberta' }).recusa).toBe(
      'competencia-nao-fechada',
    );
    expect(avaliarEnvioIras(entrada, { ...base, situacaoCompetencia: 'reaberta' }).recusa).toBe(
      'competencia-nao-fechada',
    );
    expect(avaliarEnvioIras(entrada, { ...base, situacaoCompetencia: 'enviada' }).recusa).toBeNull();
    expect(avaliarEnvioIras({ ...entrada, formulario: 'qualquer' }, base).recusa).toBe('formulario-invalido');
    const anteriores = [{ formulario: 'uti_adulto', situacao: 'pendente' as const }];
    expect(
      avaliarEnvioIras({ ...entrada, motivoRetificacao: 'Corrigido o denominador' }, { ...base, anteriores })
        .recusa,
    ).toBe('envio-pendente-aberto');
  });

  it('o envio transcrito exige a data, nem futura nem até o último dia da competência; o pendente não', () => {
    expect(avaliarEnvioIras({ ...entrada, enviadoEm: null }, base).recusa).toBe('data-envio-obrigatoria');
    expect(avaliarEnvioIras({ ...entrada, enviadoEm: '2026-03-11' }, base).recusa).toBe('data-envio-futura');
    expect(avaliarEnvioIras({ ...entrada, enviadoEm: '2026-02-28' }, base).recusa).toBe(
      'data-envio-antes-da-competencia',
    );
    expect(avaliarEnvioIras({ ...entrada, enviadoEm: '2026-03-01T09:00:00' }, base).recusa).toBeNull();
    expect(avaliarEnvioIras({ ...entrada, situacao: 'pendente', enviadoEm: null }, base).recusa).toBeNull();
  });

  it('o andamento segue o caminho único e a rejeição exige a mensagem', () => {
    const ctx = { competencia: '2026-02', hoje: '2026-03-10', enviadoAntes: '2026-03-05' };
    const a = (situacao: 'transcrita' | 'aceita' | 'rejeitada', extra = {}) => ({
      situacao,
      enviadoEm: null,
      mensagemRetorno: null,
      ...extra,
    });
    expect(
      avaliarAndamentoIras('pendente', a('transcrita', { enviadoEm: '2026-03-06' }), {
        ...ctx,
        enviadoAntes: null,
      }),
    ).toBeNull();
    expect(avaliarAndamentoIras('pendente', a('transcrita'), { ...ctx, enviadoAntes: null })).toBe(
      'data-envio-obrigatoria',
    );
    expect(avaliarAndamentoIras('pendente', a('aceita'), ctx)).toBe('transicao-invalida');
    expect(avaliarAndamentoIras('transcrita', a('aceita'), ctx)).toBeNull();
    expect(avaliarAndamentoIras('transcrita', a('rejeitada'), ctx)).toBe('retorno-sem-mensagem');
    expect(
      avaliarAndamentoIras('transcrita', a('rejeitada', { mensagemRetorno: 'Denominador zerado' }), ctx),
    ).toBeNull();
    expect(avaliarAndamentoIras('aceita', a('rejeitada', { mensagemRetorno: 'x' }), ctx)).toBe(
      'transicao-invalida',
    );
    expect(avaliarAndamentoIras('rejeitada', a('aceita'), ctx)).toBe('transicao-invalida');
  });

  it('marca o atraso depois do prazo quando o último envio não foi transmitido', () => {
    expect(envioAtrasado('2026-02', '2026-03-15', null)).toBe(false);
    expect(envioAtrasado('2026-02', '2026-03-16', null)).toBe(true);
    expect(envioAtrasado('2026-02', '2026-03-16', 'pendente')).toBe(true);
    expect(envioAtrasado('2026-02', '2026-03-16', 'rejeitada')).toBe(true);
    expect(envioAtrasado('2026-02', '2026-03-16', 'transcrita')).toBe(false);
    expect(envioAtrasado('2026-02', '2026-04-01', 'aceita')).toBe(false);
  });
  it('o formulário devido pelo componente vigiado, sem envio, fica atrasado depois do prazo e atrasa a competência', () => {
    expect(formularioDoComponente('cirurgico')).toBe('cirurgia');
    expect(formularioDoComponente('uti_neonatal')).toBe('uti_neonatal');
    expect(formularioDoComponente('geral')).toBeNull();
    const ultimas = new Map([['uti_adulto', 'transcrita']] as const);
    const depois = situacaoDosFormularios('2026-02', '2026-03-16', ['cirurgia', 'uti_adulto'], ultimas);
    expect(depois.formularios).toEqual([
      { formulario: 'uti_adulto', ultima: 'transcrita', atrasado: false },
      { formulario: 'cirurgia', ultima: null, atrasado: true },
    ]);
    expect(depois.atrasada).toBe(true);
    // No prazo nada atrasa; com todos os devidos transmitidos, a competência sai do atraso.
    expect(situacaoDosFormularios('2026-02', '2026-03-15', ['cirurgia'], ultimas).atrasada).toBe(false);
    const todos = new Map([
      ['uti_adulto', 'transcrita'],
      ['cirurgia', 'aceita'],
    ] as const);
    expect(situacaoDosFormularios('2026-02', '2026-04-01', ['cirurgia', 'uti_adulto'], todos).atrasada).toBe(
      false,
    );
    // Sem formulário devido nem envio: atrasa depois do prazo.
    expect(situacaoDosFormularios('2026-02', '2026-03-16', [], new Map())).toEqual({
      formularios: [],
      atrasada: true,
    });
  });
});
