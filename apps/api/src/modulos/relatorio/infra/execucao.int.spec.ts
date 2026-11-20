// Regra 3 (M34) na cópia: a execução dos relatórios do catálogo em transação READ ONLY (a escrita é recusada pelo
// banco), com teto de linhas e tempo — a consulta acima do tempo é CANCELADA pelo driver, a mensagem sai em
// português e a conexão segue boa (nenhuma transação presa); cada relatório do catálogo roda na cópia com o período
// curto; o acesso de origem pelos relatórios que a triagem liga ao do catálogo; e a gestão (agendamento, execução,
// pedido) em SGH_ com a trilha, desfeita no fim. Só contagens no log; nenhum valor de linha impresso.
import { resolve } from 'node:path';
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import {
  acessoDeOrigem,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  ErroRelatorio,
  executarRelatorioCatalogo,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  resumoTriagem,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaRelatorioNaTransacao } from '../porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;
const ctx = () => ({ rede: nucleo.rede, hospital: cod, traceId: 'int-m34-relatorio' });

/** Parâmetros curtos de cada relatório (o período de uma semana de 2026; a régua escolhida). */
const PARAMETROS: Readonly<Record<string, Record<string, string | number>>> = {
  faturamentoPorConvenio: { mesInicio: '2026-06', mesFim: '2026-06', regua: 'competencia' },
  glosasPorConvenio: { mesInicio: '2026-03', mesFim: '2026-03', regua: 'data-do-item' },
  contasNaoFechadas: { inicio: '2026-09-01', fim: '2026-09-07', tipo: 'todas' },
  examesPorSetor: { inicio: '2026-09-01', fim: '2026-09-02' },
  mapaCirurgicoDia: { dia: '2026-09-01' },
  cirurgiasPorPeriodo: { inicio: '2026-09-01', fim: '2026-09-07' },
  internadosNaData: { dia: '2026-09-01' },
  atendimentosPorDia: { inicio: '2026-09-01', fim: '2026-09-03' },
  // W0-09 (catálogo A; o teste por relatório com os arquivos e a trilha está em catalogo-w0-09.int.spec.ts).
  censoDiarioPorUnidade: { dia: '2026-06-15' },
  altasEObitos: { inicio: '2026-06-01', fim: '2026-06-07' },
  producaoPorProfissionalSetor: { mesInicio: '2026-06', mesFim: '2026-06' },
  consumoPorCentroCusto: { mesInicio: '2026-06', mesFim: '2026-06' },
  curvaAbcConsumo: { mesInicio: '2026-06', mesFim: '2026-06' },
  validadeLote: { dias: 60 },
  // Catálogo B (dietas e atendimentos em junho; a cópia não tem BPA nem AIH: a consulta roda e volta vazia).
  dietasServidas: { inicio: '2026-06-01', fim: '2026-06-03' },
  prontuariosEmprestados: { setorSame: 8, inicio: '2026-01-01', fim: '2026-06-30' },
  atendimentosPorConvenio: { inicio: '2026-06-01', fim: '2026-06-07' },
  producaoSus: { mesInicio: '2026-06', mesFim: '2026-06' },
  escalaAgendas: { situacao: 'todas' },
};

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

describe.skipIf(!PODE)('execução segura do catálogo na cópia (regra 3)', () => {
  it('cada relatório do catálogo roda na cópia com o período curto (READ ONLY, dentro do teto)', async () => {
    expect(Object.keys(PARAMETROS).sort()).toEqual(RELATORIOS_CATALOGO.map((r) => r.codigo).sort());
    const contagens: Record<string, number> = {};
    for (const r of RELATORIOS_CATALOGO) {
      const x = await nucleo
        .lerSomente(ctx(), (l) =>
          executarRelatorioCatalogo(l, r.codigo, PARAMETROS[r.codigo]!, {
            teto: r.tetoLinhas,
            tempoMaximoMs: r.tempoMaximoMs,
          }),
        )
        .catch((e: unknown) => {
          throw new Error(`${r.codigo}: ${e instanceof Error ? e.message : 'erro'}`);
        });
      contagens[r.codigo] = x.linhas.length;
      // As colunas do resultado são as da parte pública (o mapeamento não inventa campo).
      for (const l of x.linhas.slice(0, 5))
        for (const k of Object.keys(l)) expect(r.colunas.map((c) => c.campo)).toContain(k);
    }
    console.log('relatórios na cópia (linhas):', JSON.stringify(contagens));
    expect(Object.values(contagens).some((n) => n > 0)).toBe(true);
  });

  it('a escrita é recusada pelo banco na transação de leitura', async () => {
    // O INSERT … RETURNING é uma instrução que devolve linha (o leitor executa); a transação de leitura o recusa.
    await expect(
      nucleo.lerSomente(ctx(), (l) =>
        l.consultar(
          `INSERT INTO SGH_REL_PEDIDO (ID, HOSPITAL, TITULO, DESCRICAO, FINALIDADE, AREA, SOLICITANTE, PRAZO, SITUACAO)
           VALUES (-1, ?, 'teste', 'teste', 'teste', 'teste', 'SGH.TESTE', CURRENT_DATE, 'aberto') RETURNING ID`,
          [cod],
        ),
      ),
    ).rejects.toThrow(/read-only|somente leitura|attempted update|Consulta de leitura/i);
    const [x] = await nucleo.lerSomente(ctx(), (l) =>
      l.consultar('SELECT COUNT(*) N FROM SGH_REL_PEDIDO WHERE ID = -1', [], { teto: 1 }),
    );
    expect(Number(x?.['N'])).toBe(0);
  });

  it('acima do tempo, a consulta é cancelada com mensagem em português e a conexão segue boa', async () => {
    const inicio = Date.now();
    const erro = await nucleo
      .lerSomente(ctx(), (l) =>
        executarRelatorioCatalogo(
          l,
          'faturamentoPorConvenio',
          { mesInicio: '2024-01', mesFim: '2026-06', regua: 'data-do-item' },
          { teto: 2_000, tempoMaximoMs: 400 },
        ),
      )
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroRelatorio);
    expect((erro as ErroRelatorio).motivo).toBe('tempo');
    expect((erro as Error).message).toMatch(/passou do tempo máximo .* e foi cancelado: diminua o período/);
    expect(Date.now() - inicio).toBeLessThan(30_000);
    // A mesma conexão (pool de 3) responde logo depois: nada ficou preso.
    const [x] = await nucleo.lerSomente(ctx(), (l) =>
      l.consultar('SELECT 1 N FROM RDB$DATABASE', [], { teto: 1 }),
    );
    expect(Number(x?.['N'])).toBe(1);
  });

  it('acima do teto de linhas, recusada com a mensagem em português', async () => {
    const erro = await nucleo
      .lerSomente(ctx(), (l) =>
        executarRelatorioCatalogo(
          l,
          'atendimentosPorDia',
          { inicio: '2026-01-01', fim: '2026-09-30' },
          { teto: 3, tempoMaximoMs: 60_000 },
        ),
      )
      .catch((e: unknown) => e);
    expect((erro as ErroRelatorio).motivo).toBe('teto');
    expect((erro as Error).message).toMatch(/passou do teto de 3 linhas/);
  });

  it('a triagem gravada nas cópias: 252 com destino e dono; o acesso de origem do catálogo', async () => {
    const r = await nucleo.lerSomente(ctx(), (l) => resumoTriagem(l, cod));
    expect(r.total).toBe(252);
    expect(r.semDono).toBe(0);
    expect(r.porDestino['catalogo']).toBeGreaterThan(0);
    const a = await nucleo.lerSomente(ctx(), (l) =>
      acessoDeOrigem(l, cod, 'faturamentoPorConvenio', 'SGH.SEM-GRUPO', null),
    );
    expect(a.relatorios).toBeGreaterThan(0);
    console.log('acesso de origem (faturamento por convênio):', JSON.stringify(a));
  });

  it('agendamento, execução e pedido em SGH_ com a trilha (desfeito no fim)', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaRelatorioNaTransacao(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const trilha = (op: string) => ({
        rede: nucleo.rede,
        hospital: cod,
        usuario: 'SGH.TESTE',
        evento: 'relatorio.agendamento.alterado',
        recurso: 'relatorio.agendamento',
        operacao: op,
        tabelaAlvo: 'SGH_REL_AGENDAMENTO',
        idAlvo: null,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'int-m34',
        correlacao: 'int-m34-relatorio',
      });
      const id = await porta.gravarSgh(c, trilha('criar'), (g) =>
        g.criarAgendamento(
          {
            relatorio: 'atendimentosPorDia',
            titulo: 'Teste de integração',
            parametros: { inicio: 'ontem', fim: 'ontem' },
            grupos: ['DIRETORIA'],
            enderecos: ['teste@exemplo.invalid'],
            periodicidade: 'diaria',
            hora: 700,
            diaSemana: null,
            diaMes: null,
          },
          'SGH.TESTE',
          new Date('2026-10-23T07:00:00Z'),
        ),
      );
      const a = await porta.agendamento(c, id);
      expect(a).toMatchObject({
        titulo: 'Teste de integração',
        ativo: true,
        enderecos: ['teste@exemplo.invalid'],
      });
      await porta.gravarSgh(c, trilha('execucao'), (g) =>
        g.registrarExecucao({
          relatorio: 'atendimentosPorDia',
          tipo: 'exportacao',
          formato: 'csv',
          usuario: 'SGH.TESTE',
          parametros: '{"fim":"2026-09-03","inicio":"2026-09-01"}',
          linhas: 6,
          duracaoMs: 12,
          dadoPessoal: false,
          mascarado: true,
          justificativa: null,
          situacao: 'ok',
          agendamento: id,
        }),
      );
      // A exportação com dado de pessoa sem máscara e sem justificativa é recusada pelo próprio banco (CHECK).
      await expect(
        porta.gravarSgh(c, trilha('execucao'), (g) =>
          g.registrarExecucao({
            relatorio: 'contasNaoFechadas',
            tipo: 'exportacao',
            formato: 'csv',
            usuario: 'SGH.TESTE',
            parametros: '{}',
            linhas: 1,
            duracaoMs: 1,
            dadoPessoal: true,
            mascarado: false,
            justificativa: null,
            situacao: 'ok',
            agendamento: null,
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
