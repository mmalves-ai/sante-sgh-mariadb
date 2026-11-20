// Análise de causa e plano de ação 5W2H (M48, etapa 2): quem analisa, o início e a conclusão da análise, as ações e a
// eficácia. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { ConteudoAnalise } from '@sgh/contratos';
import {
  acaoAtrasada,
  acoesAtivas,
  causaRaizProposta,
  conferirAcaoNova,
  conferirAlteracaoAcao,
  conferirAnalise,
  conferirEficacia,
  conferirSituacaoAcao,
  fatoresDaAnalise,
  MENSAGENS_RECUSA_ANALISE,
  podeAnalisar,
  resumoDoPlano,
  TETO_ACOES_PLANO,
  type EstadoAcao,
} from './analise.js';

const porques: ConteudoAnalise = {
  metodo: 'cincoPorques',
  porques: ['Paciente caiu ao levantar', 'Grade abaixada', 'Falta de orientação sobre a grade no plantão'],
};
const londres: ConteudoAnalise = {
  metodo: 'londres',
  cronologia: 'Sequência sintética dos fatos em ordem.',
  problemas: [
    { descricao: 'Grade abaixada', fatores: ['equipe', 'tarefa'] },
    { descricao: 'Sem pulseira de risco', fatores: ['organizacao'] },
  ],
};
const ishikawa: ConteudoAnalise = { metodo: 'ishikawa', causas: [{ categoria: 'metodo', texto: 'Sem POP' }] };
const entrada = {
  versao: 0,
  conteudo: porques,
  causaRaiz: null,
  fatores: [] as const,
  concluir: false,
  semAcaoJustificativa: null,
};

describe('quem analisa', () => {
  it('NSP sempre; o gestor só a distribuída a ele; nunca antes da distribuição', () => {
    const n = { situacao: 'emAnalise' as const, gestor: 'GESTOR.SINT' };
    expect(podeAnalisar(n, { nsp: true, login: 'x' })).toBe(true);
    expect(podeAnalisar(n, { nsp: false, login: 'gestor.sint ' })).toBe(true);
    expect(podeAnalisar(n, { nsp: false, login: 'outro' })).toBe(false);
    expect(podeAnalisar({ situacao: 'triada', gestor: null }, { nsp: true, login: 'x' })).toBe(false);
    expect(podeAnalisar({ situacao: 'concluida', gestor: null }, { nsp: false, login: 'x' })).toBe(false);
  });
});

describe('conferirAnalise', () => {
  it('a primeira análise da distribuída inicia (em análise) e propõe a causa raiz pelo último porquê', () => {
    const r = conferirAnalise({ situacao: 'distribuida' }, null, entrada, 0);
    expect(r).toEqual({
      ok: true,
      valor: {
        criar: true,
        situacao: 'rascunho',
        eventos: ['analiseIniciada'],
        situacaoNotificacao: 'emAnalise',
        causaRaiz: 'Falta de orientação sobre a grade no plantão',
        fatores: [],
      },
    });
  });

  it('atualiza a em análise sem evento; conclui com causa raiz e ação', () => {
    const atual = { situacao: 'rascunho' as const, versao: 2 };
    const r1 = conferirAnalise({ situacao: 'emAnalise' }, atual, { ...entrada, versao: 2 }, 0);
    expect(r1.ok && r1.valor.eventos).toEqual([]);
    expect(r1.ok && r1.valor.situacaoNotificacao).toBeNull();
    const r2 = conferirAnalise(
      { situacao: 'emAnalise' },
      atual,
      { ...entrada, versao: 2, concluir: true, causaRaiz: 'Ausência de rotina de checagem da grade' },
      1,
    );
    expect(r2.ok && r2.valor).toMatchObject({
      situacao: 'concluida',
      eventos: ['analiseConcluida'],
      situacaoNotificacao: 'concluida',
      causaRaiz: 'Ausência de rotina de checagem da grade',
    });
  });

  it('iniciar e concluir de uma vez dá os dois eventos', () => {
    const r = conferirAnalise({ situacao: 'distribuida' }, null, { ...entrada, concluir: true }, 2);
    expect(r.ok && r.valor.eventos).toEqual(['analiseIniciada', 'analiseConcluida']);
  });

  it('recusas: versão, concluída, situação, sem causa raiz, sem ação, conteúdo grande', () => {
    expect(conferirAnalise({ situacao: 'distribuida' }, null, { ...entrada, versao: 1 }, 0)).toEqual({
      ok: false,
      motivo: 'versao-desatualizada',
    });
    expect(
      conferirAnalise({ situacao: 'emAnalise' }, { situacao: 'rascunho', versao: 3 }, entrada, 0),
    ).toMatchObject({ motivo: 'versao-desatualizada' });
    expect(
      conferirAnalise({ situacao: 'concluida' }, { situacao: 'concluida', versao: 0 }, entrada, 0),
    ).toMatchObject({ motivo: 'analise-concluida' });
    expect(conferirAnalise({ situacao: 'triada' }, null, entrada, 0)).toMatchObject({
      motivo: 'situacao-nao-permite',
    });
    expect(
      conferirAnalise(
        { situacao: 'distribuida' },
        null,
        { ...entrada, conteudo: ishikawa, concluir: true },
        1,
      ),
    ).toMatchObject({ motivo: 'sem-causa-raiz' });
    expect(
      conferirAnalise(
        { situacao: 'distribuida' },
        null,
        { ...entrada, concluir: true, causaRaiz: 'curta' },
        1,
      ),
    ).toMatchObject({ motivo: 'sem-causa-raiz' });
    expect(
      conferirAnalise({ situacao: 'distribuida' }, null, { ...entrada, concluir: true }, 0),
    ).toMatchObject({
      motivo: 'sem-acao',
    });
    const comJustificativa = conferirAnalise(
      { situacao: 'distribuida' },
      null,
      { ...entrada, concluir: true, semAcaoJustificativa: 'Circunstância já corrigida na hora.' },
      0,
    );
    expect(comJustificativa.ok).toBe(true);
    const grande: ConteudoAnalise = { metodo: 'cincoPorques', porques: Array(7).fill('x'.repeat(1000)) };
    expect(
      conferirAnalise({ situacao: 'distribuida' }, null, { ...entrada, conteudo: grande }, 0),
    ).toMatchObject({
      motivo: 'conteudo-grande',
    });
  });

  it('fatores do Protocolo de Londres somam aos informados, sem repetir', () => {
    expect(fatoresDaAnalise(londres, ['equipe', 'paciente'])).toEqual([
      'equipe',
      'paciente',
      'tarefa',
      'organizacao',
    ]);
    expect(fatoresDaAnalise(ishikawa, ['ambiente'])).toEqual(['ambiente']);
    expect(causaRaizProposta(londres)).toBeNull();
    expect(
      causaRaizProposta({ metodo: 'cincoPorques', porques: [] } as unknown as ConteudoAnalise),
    ).toBeNull();
  });
});

describe('plano de ação', () => {
  const planejada: EstadoAcao = { situacao: 'planejada', versao: 1, quando: '2026-11-10', eficacia: null };
  const hoje = '2026-10-26';

  it('ação nova: plano aberto, prazo não passado, teto de ações', () => {
    expect(conferirAcaoNova({ situacao: 'emAnalise' }, { quando: hoje }, hoje, 0)).toEqual({
      ok: true,
      valor: { situacao: 'planejada' },
    });
    expect(conferirAcaoNova({ situacao: 'concluida' }, { quando: hoje }, hoje, 3).ok).toBe(true);
    expect(conferirAcaoNova({ situacao: 'triada' }, { quando: hoje }, hoje, 0)).toMatchObject({
      motivo: 'situacao-nao-permite',
    });
    expect(conferirAcaoNova({ situacao: 'emAnalise' }, { quando: '2026-10-25' }, hoje, 0)).toMatchObject({
      motivo: 'prazo-no-passado',
    });
    expect(
      conferirAcaoNova({ situacao: 'emAnalise' }, { quando: hoje }, hoje, TETO_ACOES_PLANO),
    ).toMatchObject({
      motivo: 'limite-acoes',
    });
  });

  it('alteração: só aberta; o prazo que não mudou pode estar vencido', () => {
    const vencida = { ...planejada, quando: '2026-10-01' };
    expect(
      conferirAlteracaoAcao({ situacao: 'emAnalise' }, vencida, { versao: 1, quando: '2026-10-01' }, hoje).ok,
    ).toBe(true);
    expect(
      conferirAlteracaoAcao({ situacao: 'emAnalise' }, vencida, { versao: 1, quando: '2026-10-20' }, hoje),
    ).toMatchObject({ motivo: 'prazo-no-passado' });
    expect(
      conferirAlteracaoAcao({ situacao: 'emAnalise' }, planejada, { versao: 2, quando: hoje }, hoje),
    ).toMatchObject({ motivo: 'versao-desatualizada' });
    expect(
      conferirAlteracaoAcao(
        { situacao: 'emAnalise' },
        { ...planejada, situacao: 'concluida' },
        { versao: 1, quando: hoje },
        hoje,
      ),
    ).toMatchObject({ motivo: 'situacao-nao-permite' });
  });

  it('situação: iniciar, concluir com evidência, cancelar com motivo; nada depois de encerrada', () => {
    expect(
      conferirSituacaoAcao({ situacao: 'emAnalise' }, planejada, {
        versao: 1,
        situacao: 'emAndamento',
        texto: null,
      }),
    ).toEqual({ ok: true, valor: { situacao: 'emAndamento', encerra: false } });
    expect(
      conferirSituacaoAcao({ situacao: 'emAnalise' }, planejada, {
        versao: 1,
        situacao: 'concluida',
        texto: 'curto',
      }),
    ).toMatchObject({ motivo: 'texto-obrigatorio' });
    expect(
      conferirSituacaoAcao(
        { situacao: 'concluida' },
        { ...planejada, situacao: 'emAndamento' },
        { versao: 1, situacao: 'cancelada', texto: 'Substituída pela ação 2.' },
      ),
    ).toEqual({ ok: true, valor: { situacao: 'cancelada', encerra: true } });
    expect(
      conferirSituacaoAcao(
        { situacao: 'emAnalise' },
        { ...planejada, situacao: 'concluida' },
        { versao: 1, situacao: 'emAndamento', texto: null },
      ),
    ).toMatchObject({ motivo: 'situacao-nao-permite' });
    expect(
      conferirSituacaoAcao({ situacao: 'emAnalise' }, planejada, {
        versao: 0,
        situacao: 'emAndamento',
        texto: null,
      }),
    ).toMatchObject({ motivo: 'versao-desatualizada' });
  });

  it('eficácia: só concluída, uma vez', () => {
    const concluida = { ...planejada, situacao: 'concluida' as const };
    expect(conferirEficacia(concluida, { versao: 1 })).toEqual({ ok: true, valor: { verificada: true } });
    expect(conferirEficacia(planejada, { versao: 1 })).toMatchObject({ motivo: 'eficacia-so-concluida' });
    expect(conferirEficacia({ ...concluida, eficacia: 'eficaz' }, { versao: 1 })).toMatchObject({
      motivo: 'eficacia-ja-verificada',
    });
    expect(conferirEficacia(concluida, { versao: 9 })).toMatchObject({ motivo: 'versao-desatualizada' });
  });

  it('atraso, ativas e resumo com as parcelas', () => {
    const acoes = [
      { situacao: 'planejada' as const, quando: '2026-10-20', eficacia: null },
      { situacao: 'emAndamento' as const, quando: '2026-11-20', eficacia: null },
      { situacao: 'concluida' as const, quando: '2026-10-01', eficacia: 'eficaz' as const },
      { situacao: 'concluida' as const, quando: '2026-10-01', eficacia: 'parcial' as const },
      { situacao: 'cancelada' as const, quando: '2026-10-01', eficacia: null },
    ];
    expect(acaoAtrasada(acoes[0]!, hoje)).toBe(true);
    expect(acaoAtrasada(acoes[2]!, hoje)).toBe(false);
    expect(acoesAtivas(acoes)).toBe(4);
    expect(resumoDoPlano(acoes, hoje)).toEqual({
      total: 5,
      abertas: 2,
      atrasadas: 1,
      concluidas: 2,
      canceladas: 1,
      verificadas: 2,
      eficazes: 1,
    });
  });

  it('toda recusa tem texto de tela sem nome de sistema', () => {
    for (const t of Object.values(MENSAGENS_RECUSA_ANALISE)) {
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/SPDATA|legado/i);
    }
  });
});
