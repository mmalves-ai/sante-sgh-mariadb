import { describe, expect, it } from 'vitest';
import {
  conferirAcionamentoManual,
  conferirMudancaExecucao,
  execucaoEncerrada,
  rotinaAtrasada,
  situacaoDaRotinaApos,
  situacaoFinalSemErro,
} from './rotinas-agendadas.js';

const T0 = new Date('2026-11-24T10:00:00Z');
const mais = (s: number) => new Date(T0.getTime() + s * 1000);

describe('rotinas agendadas: execução (01-SIS L95)', () => {
  it('transições: aguardando → em execução → final; encerrada não muda', () => {
    expect(conferirMudancaExecucao({ de: 'aguardando', para: 'em_execucao' })).toBeNull();
    expect(conferirMudancaExecucao({ de: 'em_execucao', para: 'concluida' })).toBeNull();
    expect(conferirMudancaExecucao({ de: 'em_execucao', para: 'concluida_com_avisos' })).toBeNull();
    expect(conferirMudancaExecucao({ de: 'aguardando', para: 'expirada' })).toBeNull();
    expect(conferirMudancaExecucao({ de: 'aguardando', para: 'concluida' })).toBe('transicao-invalida');
    expect(conferirMudancaExecucao({ de: 'concluida', para: 'falhou', mensagemErro: 'x' })).toBe(
      'transicao-invalida',
    );
    expect(conferirMudancaExecucao({ de: 'falhou', para: 'em_execucao' })).toBe('transicao-invalida');
    expect(execucaoEncerrada('expirada')).toBe(true);
    expect(execucaoEncerrada('em_execucao')).toBe(false);
  });

  it('falha exige mensagem; volumes inteiros não negativos; fim não antes do início', () => {
    expect(conferirMudancaExecucao({ de: 'em_execucao', para: 'falhou' })).toBe('falha-sem-mensagem');
    expect(conferirMudancaExecucao({ de: 'em_execucao', para: 'falhou', mensagemErro: '  ' })).toBe(
      'falha-sem-mensagem',
    );
    expect(
      conferirMudancaExecucao({ de: 'em_execucao', para: 'falhou', mensagemErro: 'tempo esgotado' }),
    ).toBeNull();
    expect(
      conferirMudancaExecucao({
        de: 'em_execucao',
        para: 'concluida',
        volumes: { lidos: 10, gravados: -1, rejeitados: 0 },
      }),
    ).toBe('volumes-invalidos');
    expect(
      conferirMudancaExecucao({
        de: 'em_execucao',
        para: 'concluida',
        volumes: { lidos: 1.5, gravados: 0, rejeitados: 0 },
      }),
    ).toBe('volumes-invalidos');
    expect(
      conferirMudancaExecucao({ de: 'em_execucao', para: 'concluida', inicioEm: mais(10), fimEm: T0 }),
    ).toBe('fim-antes-do-inicio');
  });

  it('situação da rotina depois da execução; suspensa continua suspensa', () => {
    expect(situacaoDaRotinaApos('ociosa', 'em_execucao')).toBe('em_execucao');
    expect(situacaoDaRotinaApos('em_execucao', 'concluida')).toBe('ociosa');
    expect(situacaoDaRotinaApos('em_execucao', 'concluida_com_avisos')).toBe('ociosa');
    expect(situacaoDaRotinaApos('em_execucao', 'falhou')).toBe('com_falha');
    expect(situacaoDaRotinaApos('em_execucao', 'expirada')).toBe('com_falha');
    expect(situacaoDaRotinaApos('com_falha', 'concluida')).toBe('ociosa');
    expect(situacaoDaRotinaApos('suspensa', 'concluida')).toBe('suspensa');
    expect(situacaoFinalSemErro({ lidos: 5, gravados: 5, rejeitados: 0 })).toBe('concluida');
    expect(situacaoFinalSemErro({ lidos: 5, gravados: 4, rejeitados: 1 })).toBe('concluida_com_avisos');
    expect(situacaoFinalSemErro({ lidos: 5, gravados: 5, rejeitados: 0 }, 2)).toBe('concluida_com_avisos');
  });

  it('atraso pela tolerância', () => {
    const r = {
      ativo: true,
      situacao: 'ociosa' as const,
      proximaExecucaoEm: T0,
      toleranciaAtrasoSegundos: 300,
    };
    expect(rotinaAtrasada(r, mais(300))).toEqual({ atrasada: false, segundos: 300 });
    expect(rotinaAtrasada(r, mais(301))).toEqual({ atrasada: true, segundos: 301 });
    expect(rotinaAtrasada({ ...r, toleranciaAtrasoSegundos: null }, mais(1)).atrasada).toBe(true);
    expect(rotinaAtrasada(r, mais(-60))).toEqual({ atrasada: false, segundos: 0 });
    expect(rotinaAtrasada({ ...r, situacao: 'suspensa' }, mais(9999)).atrasada).toBe(false);
    expect(rotinaAtrasada({ ...r, situacao: 'em_execucao' }, mais(9999)).atrasada).toBe(false);
    expect(rotinaAtrasada({ ...r, ativo: false }, mais(9999)).atrasada).toBe(false);
    expect(rotinaAtrasada({ ...r, proximaExecucaoEm: null }, mais(9999)).atrasada).toBe(false);
  });

  it('acionamento manual: ativa, não suspensa, aceita manual, na vigência e sem execução em curso', () => {
    const r = { ativo: true, situacao: 'ociosa' as const, permiteAcionamentoManual: true };
    expect(conferirAcionamentoManual(r, false, T0)).toBeNull();
    expect(conferirAcionamentoManual({ ...r, situacao: 'com_falha' }, false, T0)).toBeNull();
    expect(conferirAcionamentoManual({ ...r, ativo: false }, false, T0)).toBe('rotina-inativa');
    expect(conferirAcionamentoManual({ ...r, situacao: 'suspensa' }, false, T0)).toBe('rotina-suspensa');
    expect(conferirAcionamentoManual({ ...r, permiteAcionamentoManual: false }, false, T0)).toBe(
      'sem-acionamento-manual',
    );
    expect(conferirAcionamentoManual(r, true, T0)).toBe('execucao-em-curso');
    expect(conferirAcionamentoManual({ ...r, situacao: 'em_execucao' }, false, T0)).toBe('execucao-em-curso');
    expect(conferirAcionamentoManual({ ...r, vigenciaInicio: mais(1) }, false, T0)).toBe('fora-da-vigencia');
    expect(conferirAcionamentoManual({ ...r, vigenciaFim: mais(-1) }, false, T0)).toBe('fora-da-vigencia');
  });
});
