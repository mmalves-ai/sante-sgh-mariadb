// Regras da notificação de doador e da inscrição de receptor para a central estadual (F8, 06-SUS linha 65).
import { describe, expect, it } from 'vitest';
import {
  conferirInscricao,
  conferirNotificacaoDoador,
  conferirTransicaoNotificacao,
  csvConferenciaInscricoes,
  type DadosNotificacaoDoador,
} from './transplante.js';

const base: DadosNotificacaoDoador = {
  tipoDoador: 'morte_encefalica',
  notificadoEm: '2026-11-01T10:00:00Z',
  obitoEm: null,
  protocoloInicioEm: '2026-11-01T08:00:00Z',
  protocoloFimEm: null,
  abordagemFamiliarEm: null,
  familiaConsentiu: null,
  orgaosDoados: [],
  desfecho: null,
  desfechoEm: null,
  situacao: 'notificada',
};
const campos = (d: Partial<DadosNotificacaoDoador>) =>
  conferirNotificacaoDoador({ ...base, ...d }).map((p) => p.campo);

describe('conferirNotificacaoDoador', () => {
  it('aceita a notificação aberta e a doação efetivada completa', () => {
    expect(conferirNotificacaoDoador(base)).toEqual([]);
    expect(
      campos({
        protocoloFimEm: '2026-11-01T20:00:00Z',
        abordagemFamiliarEm: '2026-11-01T21:00:00Z',
        familiaConsentiu: true,
        orgaosDoados: ['rim', 'figado'],
        desfecho: 'doacao_efetivada',
        desfechoEm: '2026-11-02T06:00:00Z',
        situacao: 'encerrada',
      }),
    ).toEqual([]);
  });

  it('recusa o protocolo invertido, sem abertura ou no doador por coração parado', () => {
    expect(campos({ protocoloFimEm: '2026-11-01T07:00:00Z' })).toContain('protocoloFimEm');
    expect(campos({ protocoloInicioEm: null, protocoloFimEm: '2026-11-01T07:00:00Z' })).toContain(
      'protocoloInicioEm',
    );
    expect(campos({ tipoDoador: 'coracao_parado' })).toContain('protocoloInicioEm');
    expect(campos({ notificadoEm: '' })).toContain('notificadoEm');
  });

  it('a abordagem familiar vem depois do protocolo concluído e antes da resposta da família', () => {
    expect(campos({ abordagemFamiliarEm: '2026-11-01T09:00:00Z' })).toContain('abordagemFamiliarEm');
    expect(campos({ familiaConsentiu: true })).toContain('familiaConsentiu');
  });

  it('o desfecho é coerente com o consentimento, os órgãos e a situação', () => {
    const fim = { protocoloFimEm: '2026-11-01T20:00:00Z', abordagemFamiliarEm: '2026-11-01T21:00:00Z' };
    expect(
      campos({
        ...fim,
        familiaConsentiu: false,
        desfecho: 'doacao_efetivada',
        desfechoEm: '2026-11-02T00:00:00Z',
        situacao: 'encerrada',
      }),
    ).toEqual(['familiaConsentiu', 'orgaosDoados']);
    expect(
      campos({
        ...fim,
        familiaConsentiu: true,
        desfecho: 'recusa_familiar',
        desfechoEm: '2026-11-02T00:00:00Z',
        situacao: 'encerrada',
      }),
    ).toEqual(['familiaConsentiu']);
    expect(campos({ desfecho: 'outro', desfechoEm: '2026-11-02T00:00:00Z' })).toEqual(['situacao']);
    expect(campos({ situacao: 'encerrada' })).toEqual(['desfecho']);
    expect(campos({ desfecho: 'outro', situacao: 'encerrada' })).toEqual(['desfechoEm']);
    expect(campos({ desfecho: 'outro', desfechoEm: '2026-10-01T00:00:00Z', situacao: 'encerrada' })).toEqual([
      'desfechoEm',
    ]);
    expect(campos({ orgaosDoados: ['rim'] })).toContain('orgaosDoados');
    expect(
      campos({
        tipoDoador: 'coracao_parado',
        protocoloInicioEm: null,
        desfecho: 'morte_encefalica_nao_confirmada',
        desfechoEm: '2026-11-02T00:00:00Z',
        situacao: 'encerrada',
      }),
    ).toEqual(['desfecho']);
  });

  it('a situação só avança e as finais não mudam', () => {
    expect(conferirTransicaoNotificacao('notificada', 'em_avaliacao')).toEqual([]);
    expect(conferirTransicaoNotificacao('em_avaliacao', 'encerrada')).toEqual([]);
    expect(conferirTransicaoNotificacao('notificada', 'cancelada')).toEqual([]);
    expect(conferirTransicaoNotificacao('em_avaliacao', 'notificada')).toHaveLength(1);
    expect(conferirTransicaoNotificacao('encerrada', 'em_avaliacao')).toHaveLength(1);
    expect(conferirTransicaoNotificacao('cancelada', 'encerrada')).toHaveLength(1);
  });
});

describe('conferirInscricao', () => {
  const nova = {
    dataInscricao: '2026-10-01',
    situacao: 'ativa' as const,
    apto: true,
    motivo: null,
    dataTransplante: null,
  };

  it('inclusão na lista; duplicada no mesmo órgão é recusada', () => {
    expect(conferirInscricao(nova, null, [])).toEqual({ problemas: [], operacao: 'inclusao' });
    expect(conferirInscricao(nova, null, [{ id: 1, situacao: 'transplantado' }]).problemas).toEqual([]);
    expect(
      conferirInscricao(nova, null, [{ id: 1, situacao: 'suspensa' }]).problemas.map((p) => p.campo),
    ).toEqual(['orgao']);
    expect(
      conferirInscricao({ ...nova, situacao: 'obito', motivo: 'x' }, null, []).problemas.map((p) => p.campo),
    ).toEqual(['situacao']);
    expect(conferirInscricao({ ...nova, apto: false }, null, []).problemas.map((p) => p.campo)).toEqual([
      'motivo',
    ]);
    expect(conferirInscricao({ ...nova, dataInscricao: '' }, null, []).problemas.map((p) => p.campo)).toEqual(
      ['dataInscricao'],
    );
  });

  it('alteração pede motivo na aptidão e na saída; saída da lista é exclusão; final não muda', () => {
    expect(conferirInscricao({ ...nova, apto: false }, nova, []).problemas.map((p) => p.campo)).toEqual([
      'motivo',
    ]);
    expect(conferirInscricao({ ...nova, apto: false, motivo: 'infecção' }, nova, [])).toEqual({
      problemas: [],
      operacao: 'alteracao',
    });
    expect(
      conferirInscricao({ ...nova, situacao: 'removida' }, nova, []).problemas.map((p) => p.campo),
    ).toEqual(['motivo']);
    expect(conferirInscricao({ ...nova, situacao: 'removida', motivo: 'desistência' }, nova, [])).toEqual({
      problemas: [],
      operacao: 'exclusao',
    });
    const transplantado = { ...nova, situacao: 'transplantado' as const, dataTransplante: '2026-11-10' };
    expect(conferirInscricao(transplantado, nova, [])).toEqual({ problemas: [], operacao: 'exclusao' });
    expect(
      conferirInscricao({ ...transplantado, dataTransplante: null }, nova, []).problemas.map((p) => p.campo),
    ).toEqual(['dataTransplante']);
    expect(
      conferirInscricao({ ...transplantado, dataTransplante: '2026-09-01' }, nova, []).problemas.map(
        (p) => p.campo,
      ),
    ).toEqual(['dataTransplante']);
    expect(
      conferirInscricao({ ...nova, dataTransplante: '2026-11-10' }, nova, []).problemas.map((p) => p.campo),
    ).toEqual(['dataTransplante']);
    expect(conferirInscricao(nova, transplantado, []).problemas.map((p) => p.campo)).toEqual(['situacao']);
  });
});

describe('csvConferenciaInscricoes', () => {
  it('gera cabeçalho e linhas com ponto e vírgula, aspas e sem fórmula', () => {
    const csv = csvConferenciaInscricoes([
      {
        prontuario: 'P-1',
        paciente: 'Paciente; sintético "A"',
        cns: null,
        orgao: '=rim',
        dataInscricao: '2026-10-01',
        situacao: 'ativa',
        prioridade: 'normal',
        apto: true,
        numeroCentral: null,
        pendenteEnvio: true,
      },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'prontuario;paciente;cns;orgao;data_inscricao;situacao;prioridade;apto;numero_central;pendente_envio',
      `P-1;"Paciente; sintético ""A""";;'=rim;2026-10-01;ativa;normal;sim;;sim`,
      '',
    ]);
  });
});
