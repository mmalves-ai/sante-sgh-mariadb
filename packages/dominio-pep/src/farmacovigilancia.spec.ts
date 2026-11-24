import { describe, expect, it } from 'vitest';
import {
  condutaNaLista,
  exigeNotificacao,
  fonteNaReconciliacao,
  passoReacao,
  reacaoAlertaNaPrescricao,
  validarNovaReacao,
  validarReconciliacaoDaLista,
  validarUsoContinuo,
} from './farmacovigilancia.js';

const agora = new Date('2026-11-24T12:00:00Z');
const codigos = (f: { codigo: string }[]) => f.map((x) => x.codigo);

describe('reação adversa a medicamento', () => {
  it('exige medicamento suspeito, manifestação e período coerente', () => {
    expect(
      codigos(
        validarNovaReacao(
          {
            prescricaoItem: null,
            itemPrescritivel: null,
            medicamentoDescricao: ' ',
            descricao: 'x',
            inicio: new Date('2026-11-25T00:00:00Z'),
            fim: new Date('2026-11-20T00:00:00Z'),
          },
          agora,
        ),
      ),
    ).toEqual(['medicamento-obrigatorio', 'descricao-obrigatoria', 'inicio-futuro', 'periodo-invalido']);
    expect(
      validarNovaReacao(
        {
          prescricaoItem: 10,
          itemPrescritivel: null,
          medicamentoDescricao: null,
          descricao: 'Exantema',
          inicio: new Date('2026-11-24T08:00:00Z'),
          fim: null,
        },
        agora,
      ),
    ).toEqual([]);
  });

  it('segue o ciclo registro → avaliação → notificação → encerramento', () => {
    expect(
      passoReacao({
        etapa: 'avaliacao_farmacia',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
      }),
    ).toEqual({
      falha: expect.objectContaining({ codigo: 'causalidade-obrigatoria' }),
    });
    expect(
      passoReacao({
        etapa: 'avaliacao_farmacia',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
        causalidade: 2,
      }),
    ).toEqual({ situacao: 'avaliada' });
    expect(
      passoReacao({
        etapa: 'notificacao',
        situacaoAtual: 'avaliada',
        nivelGravidade: 3,
        jaNotificada: false,
      }),
    ).toEqual({
      situacao: 'notificada',
    });
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'notificada',
        nivelGravidade: 3,
        jaNotificada: true,
        desfecho: 'recuperado',
      }),
    ).toEqual({
      situacao: 'encerrada',
    });
  });

  it('reação grave ou com óbito só encerra notificada', () => {
    expect(exigeNotificacao(3, 'recuperado')).toBe(true);
    expect(exigeNotificacao(1, 'obito')).toBe(true);
    expect(exigeNotificacao(2, 'recuperado')).toBe(false);
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'avaliada',
        nivelGravidade: 3,
        jaNotificada: false,
        desfecho: 'recuperado',
      }),
    ).toEqual({ falha: expect.objectContaining({ codigo: 'notificacao-obrigatoria' }) });
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'avaliada',
        nivelGravidade: 1,
        jaNotificada: false,
        desfecho: 'recuperado',
      }),
    ).toEqual({ situacao: 'encerrada' });
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'avaliada',
        nivelGravidade: 1,
        jaNotificada: false,
      }),
    ).toEqual({
      falha: expect.objectContaining({ codigo: 'desfecho-obrigatorio' }),
    });
  });

  it('inativação e reabertura pedem justificativa; transição fora do ciclo é recusada', () => {
    expect(
      passoReacao({
        etapa: 'inativacao',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
        justificativa: 'curta',
      }),
    ).toEqual({
      falha: expect.objectContaining({ codigo: 'justificativa-obrigatoria' }),
    });
    expect(
      passoReacao({
        etapa: 'inativacao',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
        justificativa: 'registrado no paciente errado',
      }),
    ).toEqual({ situacao: 'inativa' });
    expect(
      passoReacao({
        etapa: 'inativacao',
        situacaoAtual: 'notificada',
        nivelGravidade: 1,
        jaNotificada: true,
        justificativa: 'registrado no paciente errado',
      }),
    ).toEqual({
      falha: expect.objectContaining({ codigo: 'transicao-invalida' }),
    });
    expect(
      passoReacao({
        etapa: 'reabertura',
        situacaoAtual: 'encerrada',
        nivelGravidade: 1,
        jaNotificada: false,
        justificativa: 'reação voltou após reexposição',
      }),
    ).toEqual({
      situacao: 'em_avaliacao',
    });
  });

  it('só a reação inativada deixa de alertar na prescrição', () => {
    expect(reacaoAlertaNaPrescricao('encerrada')).toBe(true);
    expect(reacaoAlertaNaPrescricao('inativa')).toBe(false);
  });
});

describe('uso contínuo e reconciliação pela lista', () => {
  it('confere produto, dose com unidade e datas', () => {
    expect(
      codigos(
        validarUsoContinuo(
          {
            itemPrescritivel: null,
            descricaoLivre: null,
            dose: 0,
            unidade: null,
            inicioUso: new Date('2027-01-01'),
            ultimaTomada: null,
          },
          agora,
        ),
      ),
    ).toEqual(['medicamento-obrigatorio', 'dose-invalida', 'inicio-futuro']);
    expect(
      validarUsoContinuo(
        {
          itemPrescritivel: null,
          descricaoLivre: 'Losartana 50 mg',
          dose: 1,
          unidade: 3,
          inicioUso: null,
          ultimaTomada: agora,
        },
        agora,
      ),
    ).toEqual([]);
  });

  it('cada medicamento ativo decidido uma vez, só da lista, com justificativa fora do manter', () => {
    expect(
      codigos(
        validarReconciliacaoDaLista(
          [1, 2, 3],
          [
            { usoContinuo: 1, conduta: 'manter', justificativa: null },
            { usoContinuo: 1, conduta: 'manter', justificativa: null },
            { usoContinuo: 9, conduta: 'suspender', justificativa: null },
          ],
        ),
      ),
    ).toEqual(['decisao-repetida', 'fora-da-lista', 'justificativa-obrigatoria', 'lista-incompleta']);
    expect(
      validarReconciliacaoDaLista(
        [1, 2],
        [
          { usoContinuo: 1, conduta: 'manter', justificativa: null },
          { usoContinuo: 2, conduta: 'suspender', justificativa: 'hipotensão na admissão' },
        ],
      ),
    ).toEqual([]);
  });

  it('traduz conduta e fonte entre a lista e a linha da reconciliação', () => {
    expect(condutaNaLista('ajustar')).toBe('ajustar_dose');
    expect(condutaNaLista('suspender')).toBe('suspender');
    expect(fonteNaReconciliacao('prontuario_anterior')).toBe('prontuario');
    expect(fonteNaReconciliacao('farmacia')).toBe('outro');
    expect(fonteNaReconciliacao('familiar')).toBe('familiar');
  });
});

describe('avaliação da farmácia antes de notificar e de encerrar', () => {
  it('encerrar sem a avaliação é recusado (avaliacao-pendente), mesmo com o desfecho', () => {
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
        jaAvaliada: false,
        desfecho: 'recuperado',
      }),
    ).toEqual({ falha: expect.objectContaining({ codigo: 'avaliacao-pendente' }) });
    // notificada antes da avaliação (grave): ainda pede a avaliação para encerrar
    expect(
      passoReacao({
        etapa: 'encerramento',
        situacaoAtual: 'em_avaliacao',
        nivelGravidade: 3,
        jaNotificada: true,
        jaAvaliada: false,
        desfecho: 'recuperado',
      }),
    ).toEqual({ falha: expect.objectContaining({ codigo: 'avaliacao-pendente' }) });
  });

  it('reação não grave só notifica depois da avaliação', () => {
    expect(
      passoReacao({
        etapa: 'notificacao',
        situacaoAtual: 'registrada',
        nivelGravidade: 1,
        jaNotificada: false,
      }),
    ).toEqual({ falha: expect.objectContaining({ codigo: 'avaliacao-pendente' }) });
  });

  it('reação grave ou com óbito notifica já, sem esperar a farmácia, e segue pendente de avaliação', () => {
    expect(
      passoReacao({
        etapa: 'notificacao',
        situacaoAtual: 'registrada',
        nivelGravidade: 3,
        jaNotificada: false,
      }),
    ).toEqual({ situacao: 'registrada' });
    expect(
      passoReacao({
        etapa: 'notificacao',
        situacaoAtual: 'em_avaliacao',
        nivelGravidade: 1,
        jaNotificada: false,
        desfecho: 'obito',
      }),
    ).toEqual({ situacao: 'em_avaliacao' });
    // a avaliação posterior leva a reação já notificada para notificada
    expect(
      passoReacao({
        etapa: 'avaliacao_farmacia',
        situacaoAtual: 'registrada',
        nivelGravidade: 3,
        jaNotificada: true,
        causalidade: 1,
      }),
    ).toEqual({ situacao: 'notificada' });
  });

  it('notificar duas vezes é recusado', () => {
    expect(
      passoReacao({
        etapa: 'notificacao',
        situacaoAtual: 'registrada',
        nivelGravidade: 3,
        jaNotificada: true,
      }),
    ).toEqual({ falha: expect.objectContaining({ codigo: 'ja-notificada' }) });
  });
});
