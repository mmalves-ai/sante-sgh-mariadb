// Auditoria por checklist, comissões, matriz GUT e não conformidades (M48, etapa 5). Contas escritas no teste.
import { describe, expect, it } from 'vitest';
import {
  comissaoAtrasada,
  contaGut,
  membrosRepetidos,
  naoConformidadeVencida,
  pontuacaoGut,
  prazoPadraoNaoConformidade,
  prioridadeGut,
  proximaReuniaoAte,
  reavaliacaoVencida,
  recusaAuditoria,
  recusaNaoConformidade,
  recusaReuniao,
  recusaRisco,
  resultadoChecklist,
  temQuorum,
} from './registros.js';

const HOJE = '2026-10-27';

describe('checklist da auditoria', () => {
  it('conformidade = (conformes + 0,5 × parciais) ÷ avaliados × 100, sem o "não se aplica"', () => {
    const itens = [
      ...Array.from({ length: 7 }, () => ({ resultado: 'conforme' as const })),
      { resultado: 'parcial' as const },
      { resultado: 'naoConforme' as const },
      { resultado: 'naoConforme' as const },
      { resultado: 'naoAplicavel' as const },
    ];
    // (7 + 0,5 × 1) ÷ 10 × 100 = 75.
    expect(resultadoChecklist(itens)).toEqual({
      conformes: 7,
      parciais: 1,
      naoConformes: 2,
      naoAplicaveis: 1,
      avaliados: 10,
      conformidade: 75,
      conta: '(7 + 0,5 × 1) ÷ 10 × 100 = 75%',
    });
  });
  it('só "não se aplica": sem conformidade', () => {
    expect(resultadoChecklist([{ resultado: 'naoAplicavel' }])).toMatchObject({
      avaliados: 0,
      conformidade: null,
      conta: null,
    });
  });
  it('a auditoria não é futura e o achado leva evidência', () => {
    const item = (resultado: 'conforme' | 'naoConforme' | 'parcial', evidencia: string | null) => ({
      requisito: 'Identificação do paciente',
      secao: null,
      resultado,
      evidencia,
    });
    expect(recusaAuditoria({ realizadaEm: '2026-10-28', itens: [item('conforme', null)] }, HOJE)).toBe(
      'data-futura',
    );
    expect(recusaAuditoria({ realizadaEm: HOJE, itens: [item('naoConforme', null)] }, HOJE)).toBe(
      'item-nao-conforme-sem-evidencia',
    );
    expect(recusaAuditoria({ realizadaEm: HOJE, itens: [item('parcial', 'ok')] }, HOJE)).toBe(
      'item-nao-conforme-sem-evidencia',
    );
    expect(
      recusaAuditoria(
        { realizadaEm: HOJE, itens: [item('naoConforme', 'Pulseira ausente em 2 de 10')] },
        HOJE,
      ),
    ).toBeNull();
  });
});

describe('comissões', () => {
  it('quórum de maioria simples', () => {
    expect(temQuorum(6, 3)).toBe(false);
    expect(temQuorum(6, 4)).toBe(true);
    expect(temQuorum(5, 3)).toBe(true);
    expect(temQuorum(0, 0)).toBe(false);
  });
  it('próxima ordinária e atraso pela periodicidade', () => {
    expect(proximaReuniaoAte('2026-08-10T14:00:00', 'bimestral')).toBe('2026-10-10');
    expect(proximaReuniaoAte(null, 'mensal')).toBeNull();
    const c = { ativa: true, periodicidade: 'mensal' as const, criadaEm: '2026-01-05T00:00:00', hoje: HOJE };
    expect(comissaoAtrasada({ ...c, ultimaOrdinaria: '2026-09-20T10:00:00' })).toBe(true);
    expect(comissaoAtrasada({ ...c, ultimaOrdinaria: '2026-10-01T10:00:00' })).toBe(false);
    // Nunca se reuniu: conta da criação.
    expect(comissaoAtrasada({ ...c, ultimaOrdinaria: null })).toBe(true);
    expect(comissaoAtrasada({ ...c, ativa: false, ultimaOrdinaria: null })).toBe(false);
  });
  it('a reunião: comissão ativa, não futura, presença dentro da composição e sem repetição', () => {
    const e = { realizadaEm: '2026-10-27T09:00', presentes: [0, 2] };
    const agora = '2026-10-27T10:00:00';
    expect(recusaReuniao(e, { ativa: true, membros: 3 }, agora)).toBeNull();
    expect(recusaReuniao(e, { ativa: false, membros: 3 }, agora)).toBe('comissao-inativa');
    expect(recusaReuniao({ ...e, realizadaEm: '2026-10-27T11:00' }, { ativa: true, membros: 3 }, agora)).toBe(
      'reuniao-futura',
    );
    expect(recusaReuniao(e, { ativa: true, membros: 2 }, agora)).toBe('presente-fora-da-composicao');
    expect(recusaReuniao({ ...e, presentes: [1, 1] }, { ativa: true, membros: 3 }, agora)).toBe(
      'presente-repetido',
    );
  });
  it('membro repetido na composição (sem caixa nem espaço repetido)', () => {
    expect(membrosRepetidos([{ nome: 'Ana  Souza' }, { nome: 'ana souza' }])).toBe(true);
    expect(membrosRepetidos([{ nome: 'Ana' }, { nome: 'Bia' }])).toBe(false);
  });
});

describe('matriz GUT', () => {
  it('pontuação G × U × T e a prioridade pelas faixas', () => {
    expect(pontuacaoGut(5, 5, 5)).toBe(125);
    expect(contaGut(4, 4, 4)).toBe('4 × 4 × 4 = 64');
    expect(prioridadeGut(64)).toBe('critica');
    expect(prioridadeGut(63)).toBe('alta');
    expect(prioridadeGut(27)).toBe('alta');
    expect(prioridadeGut(26)).toBe('moderada');
    expect(prioridadeGut(8)).toBe('moderada');
    expect(prioridadeGut(7)).toBe('baixa');
    expect(prioridadeGut(1)).toBe('baixa');
    expect(() => pontuacaoGut(0, 1, 1)).toThrow();
    expect(() => pontuacaoGut(1, 6, 1)).toThrow();
  });
  const risco = {
    gravidade: 2,
    urgencia: 2,
    tendencia: 2,
    situacao: 'identificado' as const,
    controles: null,
    justificativa: null,
    reavaliarEm: '2026-12-01',
  };
  it('aceito ou encerrado com justificativa; crítico tratado com controles; reavaliação futura', () => {
    expect(recusaRisco(risco, null, null, HOJE)).toBeNull();
    expect(recusaRisco({ ...risco, situacao: 'aceito' }, null, null, HOJE)).toBe('justificativa-obrigatoria');
    expect(
      recusaRisco(
        { ...risco, situacao: 'aceito', justificativa: 'Custo da mitigação acima do impacto.' },
        null,
        null,
        HOJE,
      ),
    ).toBeNull();
    const critico = { ...risco, gravidade: 5, urgencia: 4, tendencia: 4, situacao: 'emTratamento' as const };
    expect(recusaRisco(critico, null, null, HOJE)).toBe('controles-obrigatorios');
    expect(
      recusaRisco({ ...critico, controles: 'Dupla checagem e alarme sonoro.' }, null, null, HOJE),
    ).toBeNull();
    expect(recusaRisco({ ...risco, reavaliarEm: '2026-10-26' }, null, null, HOJE)).toBe(
      'reavaliacao-no-passado',
    );
    expect(
      recusaRisco(
        {
          ...risco,
          situacao: 'encerrado',
          justificativa: 'Equipamento substituído.',
          reavaliarEm: '2020-01-01',
        },
        null,
        null,
        HOJE,
      ),
    ).toBeNull();
  });
  it('reavaliação confere a versão; o encerrado não volta', () => {
    expect(recusaRisco(risco, { versao: 2, situacao: 'identificado' }, 1, HOJE)).toBe('versao-desatualizada');
    expect(recusaRisco(risco, { versao: 2, situacao: 'encerrado' }, 2, HOJE)).toBe('risco-encerrado');
    expect(recusaRisco(risco, { versao: 2, situacao: 'identificado' }, 2, HOJE)).toBeNull();
  });
  it('reavaliação vencida', () => {
    expect(reavaliacaoVencida({ situacao: 'mitigado', reavaliarEm: '2026-10-01' }, HOJE)).toBe(true);
    expect(reavaliacaoVencida({ situacao: 'encerrado', reavaliarEm: '2026-10-01' }, HOJE)).toBe(false);
  });
});

describe('não conformidade', () => {
  const nova = {
    origem: 'auditoria' as const,
    idOrigem: 7,
    situacao: 'aberta' as const,
    causa: null,
    plano: null,
    responsavel: null,
    prazo: null,
    eficacia: null,
    eficaciaTexto: null,
    versao: null,
  };
  const tratamento = {
    causa: 'Falta de treinamento da equipe noturna.',
    plano: 'Treinar a equipe noturna e auditar em 30 dias.',
    responsavel: 'Coordenação de enfermagem',
    prazo: '2026-11-26',
  };
  it('prazo padrão pela classificação', () => {
    expect(prazoPadraoNaoConformidade('maior', '2026-10-27T10:00')).toBe('2026-11-26');
    expect(prazoPadraoNaoConformidade('observacao', '2026-10-27')).toBe('2027-01-25');
  });
  it('nasce aberta ou em tratamento (com o tratamento completo)', () => {
    expect(recusaNaoConformidade(nova, null, HOJE)).toBeNull();
    expect(recusaNaoConformidade({ ...nova, situacao: 'emTratamento' }, null, HOJE)).toBe(
      'tratamento-incompleto',
    );
    expect(
      recusaNaoConformidade({ ...nova, situacao: 'emTratamento', ...tratamento }, null, HOJE),
    ).toBeNull();
    expect(recusaNaoConformidade({ ...nova, situacao: 'encerrada' }, null, HOJE)).toBe('transicao-invalida');
  });
  it('origem com registro só nas que têm registro no Sante', () => {
    expect(recusaNaoConformidade({ ...nova, idOrigem: null }, null, HOJE)).toBe('origem-sem-registro');
    expect(recusaNaoConformidade({ ...nova, origem: 'externa', idOrigem: 3 }, null, HOJE)).toBe(
      'origem-sem-registro',
    );
    expect(recusaNaoConformidade({ ...nova, origem: 'externa', idOrigem: null }, null, HOJE)).toBeNull();
  });
  it('ciclo: tratamento → verificação → encerrada eficaz; ineficaz volta ao tratamento', () => {
    const ex = (
      situacao: 'aberta' | 'emTratamento' | 'verificacao' | 'encerrada',
      prazo: string | null = null,
    ) => ({
      versao: 3,
      situacao,
      origem: 'auditoria',
      idOrigem: 7,
      prazo,
    });
    const em = { ...nova, ...tratamento, versao: 3 };
    expect(recusaNaoConformidade({ ...em, situacao: 'emTratamento' }, ex('aberta'), HOJE)).toBeNull();
    expect(recusaNaoConformidade({ ...em, situacao: 'verificacao' }, ex('aberta'), HOJE)).toBe(
      'transicao-invalida',
    );
    expect(recusaNaoConformidade({ ...em, situacao: 'verificacao' }, ex('emTratamento'), HOJE)).toBeNull();
    expect(recusaNaoConformidade({ ...em, situacao: 'encerrada' }, ex('verificacao'), HOJE)).toBe(
      'eficacia-obrigatoria',
    );
    expect(
      recusaNaoConformidade(
        {
          ...em,
          situacao: 'encerrada',
          eficacia: 'ineficaz',
          eficaciaTexto: 'Voltou a ocorrer em novembro.',
        },
        ex('verificacao'),
        HOJE,
      ),
    ).toBe('ineficaz-nao-encerra');
    expect(
      recusaNaoConformidade(
        { ...em, situacao: 'encerrada', eficacia: 'eficaz', eficaciaTexto: 'Sem recorrência em 60 dias.' },
        ex('verificacao'),
        HOJE,
      ),
    ).toBeNull();
    expect(recusaNaoConformidade({ ...em, situacao: 'emTratamento' }, ex('verificacao'), HOJE)).toBeNull();
    expect(
      recusaNaoConformidade(
        { ...em, situacao: 'emTratamento', eficacia: 'eficaz' },
        ex('emTratamento'),
        HOJE,
      ),
    ).toBe('eficacia-fora-de-hora');
    expect(recusaNaoConformidade({ ...em, situacao: 'encerrada' }, ex('encerrada'), HOJE)).toBe(
      'transicao-invalida',
    );
  });
  it('versão, origem fixa e prazo', () => {
    const ex = {
      versao: 3,
      situacao: 'emTratamento' as const,
      origem: 'auditoria',
      idOrigem: 7,
      prazo: '2026-10-01',
    };
    expect(
      recusaNaoConformidade({ ...nova, ...tratamento, situacao: 'emTratamento', versao: 2 }, ex, HOJE),
    ).toBe('versao-desatualizada');
    expect(
      recusaNaoConformidade(
        { ...nova, ...tratamento, idOrigem: 8, situacao: 'emTratamento', versao: 3 },
        ex,
        HOJE,
      ),
    ).toBe('origem-alterada');
    // O prazo já vencido e mantido segue; o novo no passado, não.
    expect(
      recusaNaoConformidade(
        { ...nova, ...tratamento, prazo: '2026-10-01', situacao: 'emTratamento', versao: 3 },
        ex,
        HOJE,
      ),
    ).toBeNull();
    expect(
      recusaNaoConformidade(
        { ...nova, ...tratamento, prazo: '2026-10-02', situacao: 'emTratamento', versao: 3 },
        ex,
        HOJE,
      ),
    ).toBe('prazo-no-passado');
  });
  it('vencida: não encerrada com o prazo passado', () => {
    expect(naoConformidadeVencida({ situacao: 'emTratamento', prazo: '2026-10-26' }, HOJE)).toBe(true);
    expect(naoConformidadeVencida({ situacao: 'encerrada', prazo: '2026-10-26' }, HOJE)).toBe(false);
    expect(naoConformidadeVencida({ situacao: 'aberta', prazo: null }, HOJE)).toBe(false);
  });
});
