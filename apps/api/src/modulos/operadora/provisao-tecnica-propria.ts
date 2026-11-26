// Porta própria da contabilidade regulatória da operadora (08-SGO L111, C3-026; F7) sobre o banco do cliente:
// - o plano de contas padrão da ANS (plano_contas_padrao_ans, RN ANS 528/2022), com grau e conta-mãe pelo código;
// - o mapa das contas contábeis próprias para ele (mapa_conta_balancete_ans), por operadora e com vigência;
// - o balancete no padrão da ANS, montado dos saldos das partidas contábeis do estabelecimento até a data;
// - o cálculo mensal das provisões técnicas (provisao_tecnica_competencia e provisao_tecnica_item): PEONA e PESL pela
//   metodologia da ANS sobre a base do sistema (ou a base informada), ou os valores do atuário pela nota técnica; o
//   recálculo exclui os itens anteriores (nunca apaga) e sobe a versão; a contabilização grava o lançamento da
//   variação pela gravação da contabilização.
// A regra vem do domínio (provisao-tecnica.ts); o banco só guarda. O escopo é o estabelecimento da sessão (fora, 404).
import {
  balanceteNoPadraoAns,
  type BalanceteAns,
  baseDaCompetencia,
  type BaseMetodologiaAns,
  calcularProvisoesTecnicas,
  conferirAcaoProvisao,
  type ContaPadraoAns,
  grauDaContaAns,
  type ItemInformado,
  type MapaContaAns,
  type MetodoProvisaoTecnica,
  partidasDaProvisao,
  type ProblemaProvisaoTecnica,
  problemasDaContaPadraoAns,
  problemasDoMapaAns,
  type SituacaoProvisaoTecnica,
  superiorDaContaAns,
  type TipoProvisaoTecnica,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDosFatos, TABELAS_CONTABILIZACAO } from '@sgh/persistencia-contabil';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_PROVISAO_TECNICA = Symbol('PORTA_PROVISAO_TECNICA_OPERADORA');

export const TABELAS_PROVISAO_TECNICA = [
  'plano_contas_padrao_ans',
  'mapa_conta_balancete_ans',
  'provisao_tecnica_competencia',
  'provisao_tecnica_item',
  ...TABELAS_CONTABILIZACAO,
] as const;

export type Gravado = { readonly id: number; readonly versao: number } & Readonly<
  Record<string, string | number | boolean | null>
>;
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const naoEncontrado = () =>
  new ErroOperacao(404, 'nao-encontrado', 'Registro não encontrado', 'O registro não existe neste estabelecimento.');
function exigir(problemas: readonly ProblemaProvisaoTecnica[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const centavos = (v: unknown) => Math.round((numero(v) ?? 0) * 100);
const decimal = (c: number) => (c / 100).toFixed(2);

// ---- leituras ----
export interface ContaPadraoLida extends ContaPadraoAns {
  id: number;
  versao: number;
  grau: number;
  superior: number | null;
}
export interface MapaLido extends MapaContaAns {
  id: number;
  versao: number;
  contaAnsId: number;
  contaAnsDescricao: string;
  classificacao: string;
  contaDescricao: string;
  grupo: string | null;
  subgrupo: string | null;
  paginaDiops: number | null;
  linhaDiops: number | null;
  ativo: boolean;
}
export interface ItemProvisaoLido {
  id: number;
  sequencia: number;
  tipo: TipoProvisaoTecnica;
  conta: number;
  classificacao: string;
  valor: number;
  valorAnterior: number | null;
  observacao: string | null;
}
export interface ProvisaoLida {
  id: number;
  versao: number;
  competencia: string;
  baseInicio: string;
  baseFim: string;
  metodo: MetodoProvisaoTecnica;
  situacao: SituacaoProvisaoTecnica;
  calculadoEm: string | null;
  contabilizadoEm: string | null;
  observacao: string | null;
  total: number;
  itens: ItemProvisaoLido[];
}

export type EntradaContaPadrao = ContaPadraoAns;
export interface EntradaMapa {
  contaContabil: number;
  contaAns: string;
  duplicaValor: boolean;
  grupo: string | null;
  subgrupo: string | null;
  paginaDiops: number | null;
  linhaDiops: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export interface EntradaCalculo {
  competencia: string;
  metodo: MetodoProvisaoTecnica;
  contas: Partial<Record<TipoProvisaoTecnica, number>>;
  /** Base informada (em reais); nula: a base sai do sistema. */
  base: { contraprestacoes: number; eventos: number; avisadosNaoPagos: number } | null;
  informados: { tipo: TipoProvisaoTecnica; valor: number; observacao: string | null }[];
  notaTecnica: string | null;
  versao: number | null;
}

const contaDe = (r: Record<string, unknown>): ContaPadraoLida => {
  const mods = r['modalidades_aplicaveis'];
  const lista = typeof mods === 'string' ? (JSON.parse(mods) as string[]) : Array.isArray(mods) ? (mods as string[]) : null;
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    codigo: textoObrigatorio(r['codigo_conta_ans']),
    descricao: textoObrigatorio(r['descricao']),
    tipo: textoObrigatorio(r['tipo_conta']) as 'sintetica' | 'analitica',
    natureza: texto(r['natureza']) as 'devedora' | 'credora' | null,
    modalidades: lista,
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    versaoFonte: textoObrigatorio(r['versao_fonte']),
    grau: Number(r['grau']),
    superior: inteiro(r['superior_plano_contas_padrao_ans_id']),
  };
};
const SQL_CONTAS = `SELECT id, versao, codigo_conta_ans, descricao, tipo_conta, grau, superior_plano_contas_padrao_ans_id,
       natureza, modalidades_aplicaveis, vigencia_inicio, vigencia_fim, versao_fonte FROM plano_contas_padrao_ans`;
const SQL_MAPAS = `SELECT m.id, m.versao, m.conta_contabil_id, m.plano_contas_padrao_ans_id, m.grupo, m.subgrupo, m.pagina_diops,
       m.linha_diops, m.duplica_valor, m.vigencia_inicio, m.vigencia_fim, m.ativo, a.codigo_conta_ans, a.descricao AS ans_descricao,
       c.classificacao, c.descricao AS conta_descricao
  FROM mapa_conta_balancete_ans m JOIN plano_contas_padrao_ans a ON a.id = m.plano_contas_padrao_ans_id
  JOIN conta_contabil c ON c.id = m.conta_contabil_id`;
const mapaDe = (r: Record<string, unknown>): MapaLido => ({
  id: Number(r['id']),
  versao: Number(r['versao']),
  contaContabil: Number(r['conta_contabil_id']),
  contaAns: textoObrigatorio(r['codigo_conta_ans']),
  contaAnsId: Number(r['plano_contas_padrao_ans_id']),
  contaAnsDescricao: textoObrigatorio(r['ans_descricao']),
  classificacao: textoObrigatorio(r['classificacao']),
  contaDescricao: textoObrigatorio(r['conta_descricao']),
  duplicaValor: booleano(r['duplica_valor']),
  grupo: texto(r['grupo']),
  subgrupo: texto(r['subgrupo']),
  paginaDiops: inteiro(r['pagina_diops']),
  linhaDiops: inteiro(r['linha_diops']),
  vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
  vigenciaFim: dataIso(r['vigencia_fim']),
  ativo: booleano(r['ativo']),
});

const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaProvisaoTecnicaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-provisao-tecnica' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_PROVISAO_TECNICA,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  /** A operadora ligada ao estabelecimento, com a modalidade. */
  private static async operadora(l: Leitor, est: number, op: number): Promise<string> {
    const r = await l.uma(
      `SELECT o.modalidade FROM operadora_saude o JOIN operadora_saude_estabelecimento x ON x.operadora_saude_id = o.id
        WHERE o.id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL`,
      [op, est],
    );
    if (!r) throw naoEncontrado();
    return textoObrigatorio(r['modalidade']);
  }

  // ------------------------------------------------------------ plano padrão ---------------------------------------
  contasPadrao(c: ContextoPorta): Promise<ContaPadraoLida[]> {
    return this.ler(c, async (l) =>
      (await l.consultar(`${SQL_CONTAS} ORDER BY codigo_conta_ans, vigencia_inicio`, [], { teto: 5000 })).map(contaDe),
    );
  }

  gravarContaPadrao(c: ContextoPorta, e: EntradaContaPadrao, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.ans.conta-padrao.incluir', 'plano_contas_padrao_ans', trilha, async (tx) => {
      const codigo = e.codigo.trim();
      const prefixos = Array.from({ length: codigo.length }, (_, i) => codigo.slice(0, i + 1));
      const ex = (
        await tx.consultarParaAtualizar(`${SQL_CONTAS} WHERE codigo_conta_ans IN (${prefixos.map(() => '?').join(', ')})`, prefixos, {
          teto: 500,
        })
      ).map(contaDe);
      exigir(problemasDaContaPadraoAns({ ...e, codigo }, ex));
      const sup = superiorDaContaAns(codigo, ex, e.vigenciaInicio);
      const id = await tx.incluir('plano_contas_padrao_ans', {
        codigo_conta_ans: codigo,
        descricao: e.descricao.trim(),
        tipo_conta: e.tipo,
        grau: grauDaContaAns(codigo),
        superior_plano_contas_padrao_ans_id: sup?.id ?? null,
        natureza: e.natureza,
        modalidades_aplicaveis: e.modalidades?.length ? JSON.stringify(e.modalidades) : null,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        versao_fonte: e.versaoFonte.trim(),
      });
      return { id, versao: 1 };
    });
  }

  // ------------------------------------------------------------ mapa -----------------------------------------------
  mapas(c: ContextoPorta, op: number): Promise<MapaLido[]> {
    return this.ler(c, async (l, est) => {
      await PortaProvisaoTecnicaPropria.operadora(l, est, op);
      return (
        await l.consultar(`${SQL_MAPAS} WHERE m.operadora_saude_id = ? ORDER BY a.codigo_conta_ans, c.classificacao`, [op], {
          teto: 5000,
        })
      ).map(mapaDe);
    });
  }

  gravarMapa(c: ContextoPorta, op: number, e: EntradaMapa, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.ans.mapa-conta.incluir', 'mapa_conta_balancete_ans', trilha, async (tx, est) => {
      const modalidade = await PortaProvisaoTecnicaPropria.operadora(tx, est, op);
      const contas = (
        await tx.consultar(`${SQL_CONTAS} WHERE codigo_conta_ans = ?`, [e.contaAns.trim()], { teto: 50 })
      ).map(contaDe);
      const contaAns =
        contas.find((x) => x.vigenciaInicio <= e.vigenciaInicio && (x.vigenciaFim === null || x.vigenciaFim >= e.vigenciaInicio)) ??
        null;
      const pr = await tx.uma('SELECT id, tipo, ativo FROM conta_contabil WHERE id = ? AND excluido_em IS NULL', [e.contaContabil]);
      const propria = pr ? { id: Number(pr['id']), tipo: textoObrigatorio(pr['tipo']), ativo: booleano(pr['ativo']) } : null;
      const ex = (
        await tx.consultarParaAtualizar(
          `${SQL_MAPAS} WHERE m.operadora_saude_id = ? AND m.conta_contabil_id = ? AND m.ativo = TRUE`,
          [op, e.contaContabil],
          { teto: 200 },
        )
      ).map(mapaDe);
      exigir(problemasDoMapaAns({ ...e, contaAns: e.contaAns.trim() }, contaAns, propria, modalidade, ex));
      const id = await tx.incluir('mapa_conta_balancete_ans', {
        operadora_saude_id: op,
        conta_contabil_id: e.contaContabil,
        plano_contas_padrao_ans_id: contaAns?.id ?? 0,
        grupo: e.grupo?.trim() || null,
        subgrupo: e.subgrupo?.trim() || null,
        pagina_diops: e.paginaDiops,
        linha_diops: e.linhaDiops,
        duplica_valor: e.duplicaValor,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
      return { id, versao: 1 };
    });
  }

  /** Encerra a vigência do mapa (nunca apaga): o fim não pode ser anterior ao início. */
  encerrarMapa(c: ContextoPorta, id: number, e: { versao: number; fim: string }, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.ans.mapa-conta.encerrar', 'mapa_conta_balancete_ans', trilha, async (tx, est) => {
      const r = await tx.uma(
        `SELECT m.id, m.vigencia_inicio FROM mapa_conta_balancete_ans m JOIN operadora_saude_estabelecimento x
            ON x.operadora_saude_id = m.operadora_saude_id AND x.estabelecimento_id = ? AND x.excluido_em IS NULL WHERE m.id = ?`,
        [est, id],
      );
      if (!r) throw naoEncontrado();
      if (e.fim < (dataIso(r['vigencia_inicio']) ?? ''))
        throw recusa('vigencia-invalida', 'O fim da vigência é anterior ao início.', { campos: ['fim'] });
      const versao = await tx.alterar('mapa_conta_balancete_ans', id, e.versao, { vigencia_fim: e.fim });
      return { id, versao };
    });
  }

  // ------------------------------------------------------------ balancete ANS --------------------------------------
  balancete(c: ContextoPorta, op: number, dia: string): Promise<BalanceteAns & { data: string }> {
    return this.ler(c, async (l, est) => {
      await PortaProvisaoTecnicaPropria.operadora(l, est, op);
      const saldos = (
        await l.consultar(
          `SELECT c.id, c.classificacao,
                  COALESCE(SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE -p.valor END), 0) AS saldo
             FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
             JOIN conta_contabil c ON c.id = p.conta_contabil_id
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND p.excluido_em IS NULL AND l.data_lancamento <= ?
            GROUP BY c.id, c.classificacao`,
          [est, dia],
          { teto: 20000 },
        )
      ).map((r) => ({ contaContabil: Number(r['id']), classificacao: textoObrigatorio(r['classificacao']), saldoCentavos: centavos(r['saldo']) }));
      const mapas = (
        await l.consultar(`${SQL_MAPAS} WHERE m.operadora_saude_id = ? AND m.ativo = TRUE`, [op], { teto: 5000 })
      ).map(mapaDe);
      const plano = (await l.consultar(SQL_CONTAS, [], { teto: 5000 })).map(contaDe);
      return { data: dia, ...balanceteNoPadraoAns(saldos, mapas, plano, dia) };
    });
  }

  // ------------------------------------------------------------ provisões técnicas ---------------------------------
  provisoes(c: ContextoPorta): Promise<ProvisaoLida[]> {
    return this.ler(c, async (l, est) => {
      const cs = await l.consultar(
        `SELECT id, versao, competencia, base_inicio, base_fim, metodo, situacao, calculado_em, contabilizado_em, observacao
           FROM provisao_tecnica_competencia WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY competencia DESC, metodo`,
        [est],
        { teto: 500 },
      );
      if (!cs.length) return [];
      const ids = cs.map((r) => Number(r['id']));
      const its = await l.consultar(
        `SELECT i.id, i.provisao_tecnica_competencia_id, i.sequencia, i.tipo_provisao, i.conta_contabil_id, c.classificacao,
                i.valor, i.valor_anterior, i.observacao
           FROM provisao_tecnica_item i JOIN conta_contabil c ON c.id = i.conta_contabil_id
          WHERE i.provisao_tecnica_competencia_id IN (${ids.map(() => '?').join(', ')}) AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        ids,
        { teto: 10000 },
      );
      return cs.map((r) => {
        const id = Number(r['id']);
        const itens = its
          .filter((i) => Number(i['provisao_tecnica_competencia_id']) === id)
          .map((i) => ({
            id: Number(i['id']),
            sequencia: Number(i['sequencia']),
            tipo: textoObrigatorio(i['tipo_provisao']) as TipoProvisaoTecnica,
            conta: Number(i['conta_contabil_id']),
            classificacao: textoObrigatorio(i['classificacao']),
            valor: numero(i['valor']) ?? 0,
            valorAnterior: numero(i['valor_anterior']),
            observacao: texto(i['observacao']),
          }));
        return {
          id,
          versao: Number(r['versao']),
          competencia: dataIso(r['competencia']) ?? '',
          baseInicio: dataIso(r['base_inicio']) ?? '',
          baseFim: dataIso(r['base_fim']) ?? '',
          metodo: textoObrigatorio(r['metodo']) as MetodoProvisaoTecnica,
          situacao: textoObrigatorio(r['situacao']) as SituacaoProvisaoTecnica,
          calculadoEm: texto(r['calculado_em']),
          contabilizadoEm: texto(r['contabilizado_em']),
          observacao: texto(r['observacao']),
          total: Math.round(itens.reduce((s, i) => s + i.valor * 100, 0)) / 100,
          itens,
        };
      });
    });
  }

  /** A base da metodologia da ANS tirada do sistema: mensalidades, guias conhecidas e guias avisadas não pagas. */
  static async baseDoSistema(l: Leitor, est: number, competencia: string): Promise<BaseMetodologiaAns> {
    const b = baseDaCompetencia(competencia);
    const contra = await l.uma(
      `SELECT COALESCE(SUM(f.valor_total), 0) AS v FROM fatura_plano f
        WHERE f.estabelecimento_id = ? AND f.tipo_fatura = 'mensalidade' AND f.situacao <> 'cancelada'
          AND f.excluido_em IS NULL AND f.competencia BETWEEN ? AND ?`,
      [est, b.inicio, b.fim],
    );
    const valorGuia = 'COALESCE(g.valor_liberado, g.valor_apresentado - g.valor_glosado)';
    const eventos = await l.uma(
      `SELECT COALESCE(SUM(${valorGuia}), 0) AS v FROM guia_conta_recebida g
        WHERE g.estabelecimento_id = ? AND g.situacao IN ('auditada','liberada','paga') AND g.excluido_em IS NULL
          AND g.inicio_atendimento >= ? AND g.inicio_atendimento < ? + INTERVAL 1 DAY`,
      [est, b.inicio, b.fim],
    );
    const avisados = await l.uma(
      `SELECT COALESCE(SUM(${valorGuia}), 0) AS v FROM guia_conta_recebida g
        WHERE g.estabelecimento_id = ? AND g.situacao IN ('recebida','em_auditoria','auditada','liberada')
          AND g.excluido_em IS NULL AND g.inicio_atendimento < ? + INTERVAL 1 DAY`,
      [est, b.fim],
    );
    return {
      contraprestacoesCentavos: centavos(contra?.['v']),
      eventosCentavos: centavos(eventos?.['v']),
      avisadosNaoPagosCentavos: centavos(avisados?.['v']),
    };
  }

  calcular(c: ContextoPorta, e: EntradaCalculo, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.provisao-tecnica.calcular', 'provisao_tecnica_competencia', trilha, async (tx, est) => {
      const ex = (
        await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM provisao_tecnica_competencia
            WHERE estabelecimento_id = ? AND competencia = ? AND metodo = ? AND excluido_em IS NULL`,
          [est, e.competencia, e.metodo],
          { teto: 1 },
        )
      )[0];
      if (ex) {
        exigir(conferirAcaoProvisao(textoObrigatorio(ex['situacao']) as SituacaoProvisaoTecnica, 'calcular'));
        if (e.versao !== Number(ex['versao']))
          throw new ErroOperacao(409, 'versao-desatualizada', 'Versão desatualizada', 'A provisão foi alterada por outra pessoa.');
      }
      // Contas informadas: analíticas e ativas.
      const contas = [...new Set(Object.values(e.contas).filter((x): x is number => typeof x === 'number'))];
      if (contas.length) {
        const ok = await tx.consultar(
          `SELECT id FROM conta_contabil WHERE id IN (${contas.map(() => '?').join(', ')}) AND tipo = 'analitica' AND ativo = TRUE AND excluido_em IS NULL`,
          contas,
          { teto: 50 },
        );
        if (ok.length !== contas.length)
          throw recusa('conta-invalida', 'Use contas contábeis analíticas e ativas.', { campos: ['contas'] });
      }
      const base: BaseMetodologiaAns = e.base
        ? {
            contraprestacoesCentavos: Math.round(e.base.contraprestacoes * 100),
            eventosCentavos: Math.round(e.base.eventos * 100),
            avisadosNaoPagosCentavos: Math.round(e.base.avisadosNaoPagos * 100),
          }
        : await PortaProvisaoTecnicaPropria.baseDoSistema(tx, est, e.competencia);
      // Anteriores: a última competência calculada ou contabilizada antes desta, do mesmo método.
      const ant = await tx.consultar(
        `SELECT i.tipo_provisao, SUM(i.valor) AS v FROM provisao_tecnica_item i
           JOIN provisao_tecnica_competencia p ON p.id = i.provisao_tecnica_competencia_id
          WHERE i.excluido_em IS NULL AND p.id = (SELECT q.id FROM provisao_tecnica_competencia q
                 WHERE q.estabelecimento_id = ? AND q.metodo = ? AND q.competencia < ? AND q.excluido_em IS NULL
                   AND q.situacao IN ('calculada','contabilizada') ORDER BY q.competencia DESC LIMIT 1)
          GROUP BY i.tipo_provisao`,
        [est, e.metodo, e.competencia],
        { teto: 20 },
      );
      const anteriores = Object.fromEntries(ant.map((r) => [textoObrigatorio(r['tipo_provisao']), centavos(r['v'])]));
      const informados: ItemInformado[] = e.informados.map((i) => ({
        tipo: i.tipo,
        valorCentavos: Math.round(i.valor * 100),
        observacao: i.observacao,
      }));
      const r = calcularProvisoesTecnicas({
        competencia: e.competencia,
        metodo: e.metodo,
        contas: e.contas,
        base,
        informados,
        notaTecnica: e.notaTecnica,
        anteriores,
      });
      exigir(r.problemas);
      const periodo = baseDaCompetencia(e.competencia);
      const agora = await tx.uma<{ a: unknown }>('SELECT NOW(3) AS a');
      const usuario = tx.contexto.usuario ?? null;
      let id: number;
      let versao: number;
      if (ex) {
        id = Number(ex['id']);
        await tx.executar(
          'UPDATE provisao_tecnica_item SET excluido_em = NOW(3), excluido_por = ? WHERE provisao_tecnica_competencia_id = ? AND excluido_em IS NULL',
          [usuario, id],
        );
        versao = await tx.alterar('provisao_tecnica_competencia', id, Number(ex['versao']), {
          situacao: 'calculada',
          base_inicio: periodo.inicio,
          base_fim: periodo.fim,
          calculado_em: agora?.['a'] ?? null,
          calculado_por_usuario_id: usuario,
          observacao: r.memoria,
        });
      } else {
        id = await tx.incluir('provisao_tecnica_competencia', {
          estabelecimento_id: est,
          competencia: e.competencia,
          base_inicio: periodo.inicio,
          base_fim: periodo.fim,
          metodo: e.metodo,
          situacao: 'calculada',
          calculado_em: agora?.['a'] ?? null,
          calculado_por_usuario_id: usuario,
          observacao: r.memoria,
        });
        versao = 1;
      }
      const seq = await tx.uma('SELECT COALESCE(MAX(sequencia), 0) AS s FROM provisao_tecnica_item WHERE provisao_tecnica_competencia_id = ?', [id]);
      const desde = Number(seq?.['s'] ?? 0);
      for (const i of r.itens)
        await tx.incluir('provisao_tecnica_item', {
          provisao_tecnica_competencia_id: id,
          sequencia: desde + i.sequencia,
          tipo_provisao: i.tipo,
          conta_contabil_id: i.conta,
          valor: decimal(i.valorCentavos),
          valor_anterior: i.anteriorCentavos === null ? null : decimal(i.anteriorCentavos),
          observacao: i.memoria.slice(0, 2000),
        });
      return { id, versao, total: decimal(r.totalCentavos) };
    });
  }

  private static async travar(tx: TxOperacao, est: number, id: number, versao: number) {
    const r = (
      await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, competencia FROM provisao_tecnica_competencia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
        { teto: 1 },
      )
    )[0];
    if (!r) throw naoEncontrado();
    if (Number(r['versao']) !== versao)
      throw new ErroOperacao(409, 'versao-desatualizada', 'Versão desatualizada', 'A provisão foi alterada por outra pessoa.');
    return { situacao: textoObrigatorio(r['situacao']) as SituacaoProvisaoTecnica, competencia: dataIso(r['competencia']) ?? '' };
  }

  contabilizar(
    c: ContextoPorta,
    id: number,
    e: { versao: number; contaDespesa: number; contaReversao: number | null },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(c, 'operadora.provisao-tecnica.contabilizar', 'provisao_tecnica_competencia', trilha, async (tx, est) => {
      const p = await PortaProvisaoTecnicaPropria.travar(tx, est, id, e.versao);
      exigir(conferirAcaoProvisao(p.situacao, 'contabilizar'));
      const ids = [e.contaDespesa, ...(e.contaReversao ? [e.contaReversao] : [])];
      const cs = await tx.consultar(
        `SELECT id, classificacao FROM conta_contabil WHERE id IN (${ids.map(() => '?').join(', ')}) AND tipo = 'analitica' AND ativo = TRUE AND excluido_em IS NULL`,
        ids,
        { teto: 2 },
      );
      const classe = new Map(cs.map((r) => [Number(r['id']), textoObrigatorio(r['classificacao'])]));
      if (!classe.has(e.contaDespesa) || (e.contaReversao && !classe.has(e.contaReversao)))
        throw recusa('conta-invalida', 'Use contas contábeis analíticas e ativas.', { campos: ['contaDespesa'] });
      const itens = await tx.consultar(
        `SELECT i.tipo_provisao, i.valor, i.valor_anterior, c.classificacao FROM provisao_tecnica_item i
           JOIN conta_contabil c ON c.id = i.conta_contabil_id
          WHERE i.provisao_tecnica_competencia_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [id],
        { teto: 100 },
      );
      const fim = baseDaCompetencia(p.competencia).fim;
      const rotulo = `${p.competencia.slice(5, 7)}/${p.competencia.slice(0, 4)}`;
      const partidas = partidasDaProvisao(
        itens.map((i) => ({
          tipo: textoObrigatorio(i['tipo_provisao']),
          contaClassificacao: textoObrigatorio(i['classificacao']),
          valorCentavos: centavos(i['valor']),
          anteriorCentavos: i['valor_anterior'] === null ? null : centavos(i['valor_anterior']),
        })),
        classe.get(e.contaDespesa) ?? '',
        e.contaReversao ? (classe.get(e.contaReversao) ?? null) : null,
        rotulo,
      );
      let lancamento: number | null = null;
      if (partidas.length)
        lancamento = (
          await gravacaoDosFatos(tx, est).gravarLancamento({
            chave: `provisao-tecnica:${id}:${e.versao}`,
            tipo: 'automatico',
            empresa: est,
            data: fim,
            competencia: fim.slice(0, 7),
            historico: `Provisões técnicas da operadora ${rotulo}`,
            partidas,
            fatoId: null,
            regraId: null,
            regra: null,
            estornaId: null,
            justificativa: null,
          })
        ).id;
      const agora = await tx.uma<{ a: unknown }>('SELECT NOW(3) AS a');
      const versao = await tx.alterar('provisao_tecnica_competencia', id, e.versao, {
        situacao: 'contabilizada',
        contabilizado_em: agora?.['a'] ?? null,
      });
      return { id, versao, lancamento };
    });
  }

  cancelar(c: ContextoPorta, id: number, e: { versao: number; motivo: string }, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.provisao-tecnica.cancelar', 'provisao_tecnica_competencia', trilha, async (tx, est) => {
      const p = await PortaProvisaoTecnicaPropria.travar(tx, est, id, e.versao);
      exigir(conferirAcaoProvisao(p.situacao, 'cancelar'));
      const versao = await tx.alterar('provisao_tecnica_competencia', id, e.versao, {
        situacao: 'cancelada',
        observacao: `Cancelada: ${e.motivo.trim()}`,
      });
      return { id, versao };
    });
  }
}

export const METODOS_PROVISAO_TECNICA_PORTA: ReadonlySet<string> = new Set([
  'contasPadrao',
  'gravarContaPadrao',
  'mapas',
  'gravarMapa',
  'encerrarMapa',
  'balancete',
  'provisoes',
  'calcular',
  'contabilizar',
  'cancelar',
]);
