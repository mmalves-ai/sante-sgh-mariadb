// M58 (etapa 1) sobre a cópia (ficha, seções 4 e 6; regras 2, 3, 5 e 10), sob a trava da cópia:
//   - leituras READ ONLY no schema real, só agregados e estrutura: sessões de pessoa por dia na tabela de conexões (sem
//     o grupo de painéis), as contas técnicas declaradas, a plataforma, as funções externas, a varredura das fontes
//     PSQL e os recursos do fornecedor; tempos dentro do teto;
//   - regra 2 numa transação desfeita: a checklist (SGH_CFG_COEX_DESLIG, script 0580) grava e regrava (UPDATE) com a
//     SGH_TRILHA na mesma transação; o banco recusa a situação pendente, a contingência fora do domínio e a evidência
//     curta (CHECK); depois do ROLLBACK, as contagens como antes.
// Saída só com contagens (abaixo de 5 vira <5).
import { FUNCOES_EXTERNAS_ESPERADAS, JANELA_SEM_SESSAO_DIAS } from '@sgh/contratos';
import { avaliarSessoes, funcoesExternas, inicioDaJanela } from '@sgh/dominio-config';
import {
  contarRecursosFornecedor,
  gravarItemDesligamento,
  gravarTrilha,
  lerContasTecnicasBanco,
  lerFuncoesBanco,
  lerItensDesligamento,
  lerPlataformaBanco,
  lerSessoesOutroSistema,
  varrerFontesPsql,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

async function restricao(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      /CHECK constraint "?(SGH_CK_[A-Z_]+)"?/i.exec(msg)?.[1]?.toUpperCase() ?? `outro: ${(e as Error).name}`
    );
  }
}

describe.skipIf(!PODE_ESCREVER)('M58 (etapa 1): inventário do desligamento na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras READ ONLY: sessões no dia do retrato, contas, plataforma, funções, fontes e recursos; tempos', async () => {
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, f: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const r = await f();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      // O dia do retrato (o último dia da tabela) como "hoje": a cópia está congelada.
      const ultimo = (await lerSessoesOutroSistema(l, '2099-01-01', '2099-01-01', [])).ultimoDia;
      const hoje = ultimo ?? '2026-01-01';
      const sessoes = await medir('sessoes', () =>
        lerSessoesOutroSistema(l, inicioDaJanela(hoje, 30), inicioDaJanela(hoje, JANELA_SEM_SESSAO_DIAS), []),
      );
      const funcoes = await medir('funcoes', () => lerFuncoesBanco(l));
      return {
        hoje,
        sessoes,
        avaliadas: avaliarSessoes(sessoes.porDia, hoje, JANELA_SEM_SESSAO_DIAS, sessoes.distintosNaJanela),
        contas: await medir('contas', () => lerContasTecnicasBanco(l)),
        plataforma: await medir('plataforma', () => lerPlataformaBanco(l)),
        externas: funcoesExternas(funcoes),
        fontes: await medir('fontes', () =>
          varrerFontesPsql(
            l,
            FUNCOES_EXTERNAS_ESPERADAS.map((f) => f.nome),
          ),
        ),
        recursos: await medir('recursos', () => contarRecursosFornecedor(l)),
      };
    });
    // A série e a contagem distinta concordam (avaliarSessoes recusa a contradição); grupo de painéis fora.
    expect(r.avaliadas.pessoasNaJanela).toBe(r.sessoes.distintosNaJanela);
    expect(r.avaliadas.cumprido).toBe(r.sessoes.distintosNaJanela === 0);
    expect(r.contas.declaradas).toHaveLength(28);
    expect(r.plataforma.charsetBanco).toBe('NONE');
    expect(r.externas.map((f) => f.nome)).toEqual(FUNCOES_EXTERNAS_ESPERADAS.map((f) => f.nome));
    expect(r.externas.every((f) => f.esperada)).toBe(true);
    for (const t of Object.values(tempos)) expect(t).toBeLessThan(30_000);
    const presentes = r.contas.declaradas.filter((c) => c.presente).length;
    const escrita = r.contas.declaradas.filter((c) => c.escrita).length;
    console.log(
      `[M58.1 ${a.cod}] retrato ${r.hoje}: ${menos5(r.sessoes.distintosNaJanela)} pessoa(s) nos 14 dias (${
        r.avaliadas.cumprido ? 'cumprido' : 'não cumprido'
      }, 30 dias ${r.avaliadas.cumpridoCap14 ? 'cumprido' : 'não cumprido'}); contas ${presentes}/28 presentes, ${escrita} com escrita, ${
        r.contas.naoDeclaradas
      } fora da lista; ${r.plataforma.charsetBanco} ${r.plataforma.versaoMotor} ODS ${r.plataforma.ods}; externas ${r.externas
        .map((f) => `${f.nome}(${f.dependentes})`)
        .join(' ')}; fontes com byte alto ${JSON.stringify({
        gatilhos: r.fontes.comByteAlto.gatilhos.length,
        procedures: r.fontes.comByteAlto.procedures.length,
        bancoExterno: r.fontes.bancoExterno.gatilhos.length,
      })}; recursos ${JSON.stringify({
        paineisTv: r.recursos.paineisTv,
        agendamentos: r.recursos.agendamentosRelatorio,
        bancosExternos: r.recursos.bancosExternos,
        filaBi: r.recursos.filaBi,
        visoes: r.recursos.visoesParceiros,
      })}; tempos ${JSON.stringify(tempos)}`,
    );
  });

  it('regra 2 numa transação desfeita: grava e regrava com a trilha; o banco recusa pendente, contingência e evidência; ROLLBACK', async () => {
    const contagens = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => ({
        itens: await contar(l, 'SELECT COUNT(*) N FROM SGH_CFG_COEX_DESLIG WHERE HOSPITAL = ?', [a.cod]),
        trilha: await contar(
          l,
          "SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'coexistencia.desligamento.item'",
        ),
      }));
    const antes = await contagens();
    const trilha = (item: string) => ({
      rede: a.nucleo.rede,
      hospital: a.cod,
      usuario: 'SGH.TESTE',
      evento: 'coexistencia.desligamento.item',
      recurso: 'config.desligamento',
      operacao: `desligamento:${item}`,
      tabelaAlvo: 'SGH_CFG_COEX_DESLIG',
      idAlvo: null,
      chaveNaturalAlvo: `${a.cod}:${item}`,
      resultado: 'sucesso',
      estacao: 'SGH-TESTE:sintetico',
      correlacao: 'int-m58',
      diferenca: 'SITUACAO,CONTINGENCIA,PAPEL,EVIDENCIA',
    });
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const base = { papelResponsavel: 'TI do hospital', evidencia: 'ata sintética do teste' };
      const g1 = await gravarItemDesligamento(
        e,
        a.cod,
        {
          item: 'paineis-tv',
          situacao: 'substituto-em-uso',
          contingencia: 'reinstalavel-no-periodo',
          ...base,
        },
        'SGH.TESTE',
      );
      await gravarTrilha(e, trilha('paineis-tv'));
      const g2 = await gravarItemDesligamento(
        e,
        a.cod,
        { item: 'paineis-tv', situacao: 'aceito-como-perdido', contingencia: 'nenhuma', ...base },
        'SGH.TESTE',
      );
      await gravarTrilha(e, trilha('paineis-tv'));
      const lidos = (await lerItensDesligamento(e, a.cod)).filter((x) => x.item === 'paineis-tv');
      const insere = (item: string, situacao: string, contingencia: string, evidencia: string) =>
        restricao(
          e.executar(
            `INSERT INTO SGH_CFG_COEX_DESLIG (HOSPITAL, ITEM, SITUACAO, CONTINGENCIA, PAPEL, EVIDENCIA, ALTERADO_POR)
             VALUES (?, ?, ?, ?, 'TI', ?, 'SGH.TESTE')`,
            [a.cod, item, situacao, contingencia, evidencia],
          ),
        );
      return {
        incluiu: g1.incluido,
        alterou: !g2.incluido,
        anterior: g2.anterior,
        lidos: lidos.map((x) => `${x.item}=${x.situacao}/${x.contingencia}/${x.papelResponsavel}`),
        trilha: await contar(
          e,
          "SELECT COUNT(*) N FROM SGH_TRILHA WHERE EVENTO = 'coexistencia.desligamento.item'",
        ),
        pendente: await insere('editor-relatorios', 'pendente', 'nenhuma', 'ata do teste'),
        contingencia: await insere('editor-relatorios', 'aceito-como-perdido', 'qualquer', 'ata do teste'),
        curta: await insere('envio-agendado-relatorios', 'aceito-como-perdido', 'nenhuma', 'x'),
      };
    });
    expect(r.incluiu).toBe(true);
    expect(r.alterou).toBe(true);
    // A linha anterior lida na mesma transação, antes do UPDATE (a trilha guarda os códigos de antes e depois).
    expect(r.anterior).toMatchObject({
      situacao: 'substituto-em-uso',
      contingencia: 'reinstalavel-no-periodo',
    });
    expect(r.lidos).toEqual(['paineis-tv=aceito-como-perdido/nenhuma/TI do hospital']);
    expect(r.trilha).toBe(antes.trilha + 2);
    expect(r.pendente).toBe('SGH_CK_COEX_DESLIG_SITUACAO');
    expect(r.contingencia).toBe('SGH_CK_COEX_DESLIG_CONTING');
    expect(r.curta).toBe('SGH_CK_COEX_DESLIG_EVIDENCIA');
    const depois = await contagens();
    expect(depois).toEqual(antes);
    console.log(
      `[M58.1 ${a.cod}] checklist: incluiu e regravou (UPDATE), +2 linhas de trilha, recusas ${r.pendente}, ${r.contingencia} e ${r.curta}; depois do ROLLBACK ${JSON.stringify(depois)}`,
    );
  });
});
