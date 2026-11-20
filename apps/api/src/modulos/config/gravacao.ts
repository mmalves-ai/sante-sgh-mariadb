// Fonte das telas do M04 (conferência de gravação; saúde das conexões e avisos de colisão): catálogo
// versionado, receitas do adaptador e, quando o núcleo está ligado, pelas leituras do @sgh/legado (a API não
// escreve SQL): triggers no RDB$TRIGGERS, provas confirmadas na SGH_TRILHA (fonte compartilhada) e o MON$ de
// cada estabelecimento (leitura curta, somente leitura). Desfeitas e colisões não deixam linha no banco: vêm
// do executor deste processo. Nenhum valor de linha.
import {
  type CatalogoOperacoes,
  esquemaPainelConexoes,
  esquemaPainelGravacao,
  type PainelConexoes,
  type PainelGravacao,
} from '@sgh/contratos';
import {
  type Coleta,
  coletar,
  type EstadoPool,
  type EstadoTrigger,
  estadoDosTriggers,
  fonteCatalogo,
  type Leitor,
  lerCatalogoOperacoes,
  pastaResultadosDoCatalogo,
  MetricasExecutor,
  OPERACOES,
  provasRecentes,
  ULTIMAS_LINHAS_TRILHA,
} from '@sgh/legado';

export const METRICAS_EXECUTOR = Symbol('METRICAS_EXECUTOR');
export const FONTE_GRAVACAO = Symbol('FONTE_GRAVACAO');

export interface NucleoLeitura {
  readonly rede: string;
  estadosDosPools(): EstadoPool[];
  lerSomente<T>(
    ctx: { rede: string; hospital: string; traceId: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export interface FonteGravacao {
  painelGravacao(): Promise<PainelGravacao>;
  painelConexoes(): Promise<PainelConexoes>;
}

const ctx = (n: NucleoLeitura, hospital: string) => ({
  rede: n.rede,
  hospital,
  traceId: 'tela-coexistencia',
});

export function criarFonteGravacao(opcoes: {
  readonly catalogo: string | (() => CatalogoOperacoes);
  readonly estabelecimentos: readonly string[];
  readonly metricas: MetricasExecutor;
  readonly nucleo: NucleoLeitura | null;
  readonly limiteTransacaoMs?: number;
}): FonteGravacao {
  const ler = (): CatalogoOperacoes =>
    typeof opcoes.catalogo === 'string' ? lerCatalogoOperacoes(opcoes.catalogo) : opcoes.catalogo();
  return {
    async painelGravacao() {
      const cat = ler();
      const estabs = [...opcoes.estabelecimentos];
      const nomes = [...new Set(cat.operacoes.flatMap((o) => o.triggers.map((t) => t.nome)))];
      const noBanco: Record<string, Record<string, EstadoTrigger>> = {};
      const naTrilha: Record<string, Record<string, number>> = {};
      if (opcoes.nucleo) {
        for (const e of estabs) {
          try {
            const r = await opcoes.nucleo.lerSomente(ctx(opcoes.nucleo, e), async (l) => ({
              triggers: await estadoDosTriggers(l, nomes),
              provas: await provasRecentes(l, e),
            }));
            noBanco[e] = r.triggers;
            naTrilha[e] = r.provas;
          } catch {
            // banco indisponível: a coluna do estabelecimento fica sem conferência
          }
        }
      }
      const metricas = opcoes.metricas.resumo();
      const provasDe = (operacao: string) => {
        const r: Record<string, { sucesso: number; desfeitas: number }> = {};
        for (const m of metricas.filter((x) => x.operacao === operacao)) {
          r[m.hospital] = { sucesso: m.desfechos.sucesso ?? 0, desfeitas: m.desfechos.desfeita ?? 0 };
        }
        for (const [e, porOperacao] of Object.entries(naTrilha)) {
          // Com o banco: os sucessos vêm da trilha (todos os processos), não só deste.
          r[e] = { sucesso: porOperacao[operacao] ?? 0, desfeitas: r[e]?.desfeitas ?? 0 };
        }
        return r;
      };
      // M36 (regra 6): o estado mostrado é o efetivo (divergência na última reexecução volta a bloqueada).
      const efetivo = fonteCatalogo(cat, {
        pastaResultados:
          typeof opcoes.catalogo === 'string' ? pastaResultadosDoCatalogo(opcoes.catalogo) : null,
      });
      return esquemaPainelGravacao.parse({
        estabelecimentos: estabs,
        operacoes: cat.operacoes.map((o) => {
          const r = OPERACOES[o.nome]?.receita ?? null;
          return {
            nome: o.nome,
            modulo: o.modulo,
            descricao: o.descricao,
            estados: Object.fromEntries(estabs.map((e) => [e, efetivo.estado(o.nome, e) ?? 'bloqueada'])),
            receita: r && {
              marco: r.marco,
              passos: r.passos.map((p) => ({
                ordem: p.ordem,
                tabela: p.tabela,
                acao: p.acao,
                colunas: Object.entries(p.colunas).map(([coluna, c]) => ({
                  coluna,
                  classe: c.classe,
                  origem: c.origem,
                })),
              })),
              efeitos: r.efeitos.map((x) => ({ ...x })),
              naoFaz: [...r.naoFaz],
              condicao: r.condicao,
              concorrencia: r.concorrencia,
              prova: r.prova,
              critica: Boolean(r.critica),
            },
            triggers: o.triggers.map((t) => ({ ...t })),
            triggersNoBanco: Object.fromEntries(
              Object.entries(noBanco).map(([e, m]) => [
                e,
                Object.fromEntries(o.triggers.map((t) => [t.nome, m[t.nome] ?? 'ausente'])),
              ]),
            ),
            provas: provasDe(o.nome),
          };
        }),
        limitacao:
          `Sucessos: últimas ${ULTIMAS_LINHAS_TRILHA} linhas da trilha de cada estabelecimento (todas as origens). ` +
          'Desfeitas (prova pós-escrita) e colisões não deixam linha no banco: são as do executor deste processo da API, ' +
          'que só grava quando as operações ganharem tela (M10 e M11); reproduções da assinatura não contam.',
      });
    },
    async painelConexoes() {
      const n = opcoes.nucleo;
      const coletas: Record<string, PainelConexoes['coletas'][string]> = {};
      for (const e of opcoes.estabelecimentos) {
        if (!n) {
          coletas[e] = null;
          continue;
        }
        try {
          const c: Coleta = await n.lerSomente(ctx(n, e), (l) =>
            coletar(l, {
              estabelecimento: e,
              ...(opcoes.limiteTransacaoMs ? { limiteTransacaoMs: opcoes.limiteTransacaoMs } : {}),
            }),
          );
          coletas[e] = {
            em: c.em,
            porSistema: c.porSistema.map((s) => ({
              sistema: s.sistema,
              conexoes: s.conexoes,
              transacoes: s.transacoes,
            })),
            transacoesAcimaDoLimite: c.alertas.filter((a) => a.tipo === 'transacao-longa').length,
            esperasPorTrava: c.porSistema.reduce((a, s) => a + s.esperasPorTrava, 0),
            alertas: c.alertas.length,
          };
        } catch {
          coletas[e] = null;
        }
      }
      return esquemaPainelConexoes.parse({
        rede: n?.rede ?? '',
        pools: n ? n.estadosDosPools().map((p) => ({ ...p })) : [],
        coletas,
        colisoes: opcoes.metricas
          .resumo()
          .filter((m) => Object.keys(m.colisoesPorHora).length > 0)
          .map((m) => ({
            operacao: m.operacao,
            estabelecimento: m.hospital,
            porHora: { ...m.colisoesPorHora },
          })),
        limitacao:
          'A conta de desenvolvimento vê no monitor do Firebird só o que o papel permite; a visão das conexões dos demais sistemas depende da conta da TI.',
      });
    },
  };
}
