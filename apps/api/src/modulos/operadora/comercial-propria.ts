// Porta própria do comercial da operadora (08-SGO L100, C2-095; F8) sobre o banco do cliente:
// - força de venda: corretora (com a pessoa jurídica pelo CNPJ), vendedor e equipe com os membros;
// - regra de comissão com as faixas de parcelas (regra_comissao_venda e regra_comissao_parcela);
// - proposta de adesão com os proponentes, o fluxo de situação e a efetivação no contrato, que carimba no contrato a
//   venda (vendedor, corretora, data) de onde a comissão é apurada;
// - meta com as faixas de prêmio e a apuração do realizado (propostas, contratos, vidas ou receita paga);
// - campanha de desconto por parcela, com os participantes e as transições;
// - lote de comissão: só a mensalidade paga gera comissão; a não paga entra como pendência; a saída do contrato
//   (encerrado ou inadimplente há mais de 60 dias) dentro do prazo estorna o que já foi liberado.
// A regra vem do domínio (comercial.ts); o banco só guarda. Nada é apagado: proposta, campanha e lote mudam de situação.
// Cada gravação é uma operação do Executor (trilha na mesma transação). Escopo: o estabelecimento da sessão e a
// operadora ligada a ele (fora, 404).
import {
  apurarComissoes,
  apurarEstornos,
  apurarMeta,
  cnpjValido,
  cpfValido,
  type FaixaMeta,
  inadimplenteDesde,
  type MedidaMeta,
  type MensalidadeComissionavel,
  type ParcelaRegraComissao,
  problemasDaCampanha,
  problemasDaMeta,
  problemasDaMudancaCampanha,
  problemasDaMudancaComissao,
  problemasDaMudancaProposta,
  problemasDaProposta,
  problemasDasParcelasDaRegra,
  type ProblemaComercial,
  type Proponente,
  type ResultadoMeta,
  type SaidaContrato,
  type SituacaoCampanha,
  type SituacaoComissao,
  type SituacaoProposta,
  type TipoProponente,
  totaisDaComissao,
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
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  marcadores,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_COMERCIAL = Symbol('PORTA_COMERCIAL_OPERADORA');

export const TABELAS_COMERCIAL = [
  'corretora_venda',
  'pessoa_juridica',
  'vendedor_plano',
  'equipe_venda',
  'equipe_venda_membro',
  'regra_comissao_venda',
  'regra_comissao_parcela',
  'proposta_adesao',
  'proposta_adesao_beneficiario',
  'contrato_plano',
  'meta_venda',
  'meta_venda_item',
  'campanha_comercial_plano',
  'campanha_venda_desconto',
  'campanha_venda_participante',
  'comissao_venda',
  'comissao_venda_item',
  'sequencia_negocio',
] as const;

export const METODOS_COMERCIAL = [
  'painel',
  'proposta',
  'gravarCorretora',
  'gravarVendedor',
  'gravarEquipe',
  'gravarRegra',
  'incluirProposta',
  'mudarProposta',
  'gravarMeta',
  'apurarMeta',
  'gravarCampanha',
  'mudarCampanha',
  'apurarComissao',
  'itensComissao',
  'mudarComissao',
] as const;

export type Gravado = { readonly id: number; readonly versao: number } & Readonly<
  Record<string, string | number | boolean | null>
>;
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly ProblemaComercial[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const n = (v: unknown) => numero(v) ?? 0;
const idOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------- entradas -------------------------------------------
export interface EntradaCorretora {
  codigo: string;
  nome: string;
  tipo: 'corretora' | 'unidade_venda' | 'administradora' | 'venda_propria';
  cnpj: string | null;
  corretoraPai: number | null;
  registroSusep: string | null;
  email: string | null;
}
export interface EntradaVendedor {
  codigo: string;
  nome: string;
  cpf: string;
  corretora: number | null;
  email: string | null;
}
export interface EntradaEquipe {
  codigo: string;
  nome: string;
  corretora: number | null;
  chefe: number | null;
  membros: { vendedor: number; inicio: string }[];
}
export interface EntradaRegra {
  codigo: string;
  descricao: string;
  incidencia: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  corretora: number | null;
  equipe: number | null;
  vendedor: number | null;
  plano: number | null;
  parcelas: ParcelaRegraComissao[];
}
export interface EntradaProposta {
  propostaEm: string;
  plano: number;
  contrato: number | null;
  contratante: number | null;
  vendedor: number | null;
  corretora: number | null;
  equipe: number | null;
  diaVencimento: number | null;
  observacao: string | null;
  proponentes: Proponente[];
}
export interface MudancaPropostaEntrada {
  versao: number;
  para: SituacaoProposta;
  motivo: string | null;
  contrato: number | null;
}
export interface EntradaMeta {
  descricao: string;
  medida: MedidaMeta;
  inicio: string;
  fim: string;
  equipe: number | null;
  vendedor: number | null;
  corretora: number | null;
  valorMeta: number | null;
  faixas: FaixaMeta[];
}
export interface EntradaCampanha {
  codigo: string;
  descricao: string;
  inicio: string;
  fim: string | null;
  regra: number | null;
  condicoes: string | null;
  descontos: { parcela: number; percentual: number | null; valor: number | null }[];
  participantes: { corretora: number | null; equipe: number | null; vendedor: number | null }[];
}
export interface EntradaApuracao {
  descricao: string | null;
  regra: number;
  corretora: number | null;
  equipe: number | null;
  vendedor: number | null;
  pagamentoInicio: string;
  pagamentoFim: string;
  prazoEstornoDias: number;
  aliquotaIrrf: number;
  aliquotaIss: number;
}

// ---------------------------------------------------------------- leituras -------------------------------------------
export interface ItemLista {
  id: number;
  [k: string]: string | number | boolean | null;
}
export interface PainelComercial {
  corretoras: ItemLista[];
  vendedores: ItemLista[];
  equipes: ItemLista[];
  regras: { id: number; parcelas: ParcelaRegraComissao[]; [k: string]: unknown }[];
  incidencias: ItemLista[];
  planos: ItemLista[];
  contratos: ItemLista[];
  parentescos: ItemLista[];
  propostas: ItemLista[];
  metas: ItemLista[];
  campanhas: ItemLista[];
  lotes: ItemLista[];
}
export interface PropostaLida {
  id: number;
  versao: number;
  numero: string;
  situacao: SituacaoProposta;
  propostaEm: string;
  plano: number;
  contrato: number | null;
  contratoGerado: number | null;
  vendedor: number | null;
  corretora: number | null;
  equipe: number | null;
  diaVencimento: number | null;
  observacao: string | null;
  observacaoOperadora: string | null;
  proponentes: Proponente[];
}

const linha = (r: Record<string, unknown>): ItemLista => {
  const o: ItemLista = { id: Number(r['id']) };
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id') continue;
    o[k] =
      v === null || v === undefined
        ? null
        : v instanceof Date
          ? (dataIso(v) ?? null)
          : typeof v === 'bigint'
            ? Number(v)
            : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
              ? v
              : String(v);
  }
  return o;
};

const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaComercialPropria {
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
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-comercial' },
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
    fn: (tx: TxOperacao, est: number, hoje: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_COMERCIAL,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
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

  private static async operadoraDoEst(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }
  /** Confere que cada referência informada existe no escopo (estabelecimento ou operadora). */
  private static async conferirAlvos(
    l: Leitor,
    est: number,
    op: number,
    a: { corretora?: number | null; equipe?: number | null; vendedor?: number | null },
  ): Promise<void> {
    if (a.corretora != null) {
      const r = await l.uma(
        'SELECT id FROM corretora_venda WHERE id = ? AND operadora_saude_id = ? AND excluido_em IS NULL',
        [a.corretora, op],
      );
      if (!r)
        throw recusa('corretora-inexistente', 'A corretora não é desta operadora.', {
          campos: ['corretora'],
        });
    }
    if (a.equipe != null) {
      const r = await l.uma(
        'SELECT id FROM equipe_venda WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [a.equipe, est],
      );
      if (!r)
        throw recusa('equipe-inexistente', 'A equipe não é deste estabelecimento.', { campos: ['equipe'] });
    }
    if (a.vendedor != null) {
      const r = await l.uma(
        'SELECT id FROM vendedor_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [a.vendedor, est],
      );
      if (!r)
        throw recusa('vendedor-inexistente', 'O vendedor não é deste estabelecimento.', {
          campos: ['vendedor'],
        });
    }
  }

  // ------------------------------------------------------------ painel ---------------------------------------------
  painel(c: ContextoPorta, op: number): Promise<PainelComercial> {
    return this.ler(c, async (l, est) => {
      await PortaComercialPropria.operadoraDoEst(l, est, op);
      const q = async (sql: string, ps: unknown[]) => (await l.consultar(sql, ps, { teto: 500 })).map(linha);
      const corretoras = await q(
        `SELECT c.id, c.versao, c.codigo, c.nome, c.tipo, c.registro_susep AS registroSusep, c.situacao,
                c.corretora_pai_id AS corretoraPai, pj.cnpj
           FROM corretora_venda c LEFT JOIN pessoa_juridica pj ON pj.id = c.pessoa_juridica_id
          WHERE c.operadora_saude_id = ? AND c.excluido_em IS NULL ORDER BY c.nome`,
        [op],
      );
      const vendedores = await q(
        `SELECT v.id, v.versao, v.codigo, v.nome, v.corretora_venda_id AS corretora, v.ativo
           FROM vendedor_plano v WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL ORDER BY v.nome`,
        [est],
      );
      const equipes = await q(
        `SELECT e.id, e.versao, e.codigo, e.nome, e.corretora_venda_id AS corretora, e.chefe_vendedor_plano_id AS chefe,
                (SELECT COUNT(*) FROM equipe_venda_membro m WHERE m.equipe_venda_id = e.id AND m.excluido_em IS NULL
                    AND m.vigencia_fim IS NULL) AS membros
           FROM equipe_venda e WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL ORDER BY e.nome`,
        [est],
      );
      const regrasBase = await q(
        `SELECT r.id, r.versao, r.codigo, r.descricao, r.vigencia_inicio AS vigenciaInicio, r.vigencia_fim AS vigenciaFim,
                r.ativo, i.descricao AS incidencia
           FROM regra_comissao_venda r JOIN incidencia_comissao i ON i.id = r.incidencia_comissao_id
          WHERE r.operadora_saude_id = ? ORDER BY r.codigo`,
        [op],
      );
      const regras = [];
      for (const r of regrasBase) regras.push({ ...r, parcelas: await lerParcelas(l, r.id) });
      const incidencias = await q(
        `SELECT id, codigo, descricao, base_calculo AS base FROM incidencia_comissao WHERE ativo = TRUE ORDER BY descricao`,
        [],
      );
      const planos = await q(
        `SELECT pc.id, pc.codigo, pc.nome_comercial AS nome FROM plano_comercializado pc
           JOIN produto_plano p ON p.id = pc.produto_plano_id
          WHERE pc.estabelecimento_id = ? AND p.operadora_saude_id = ? AND pc.excluido_em IS NULL AND pc.situacao = 'ativo'
          ORDER BY pc.nome_comercial`,
        [est, op],
      );
      const contratos = await q(
        `SELECT k.id, k.numero, k.situacao, k.contratante_plano_id AS contratante FROM contrato_plano k
          WHERE k.estabelecimento_id = ? AND k.operadora_saude_id = ? AND k.excluido_em IS NULL ORDER BY k.numero`,
        [est, op],
      );
      const parentescos = await q(
        'SELECT id, descricao FROM grau_parentesco_dependente WHERE ativo = TRUE ORDER BY descricao',
        [],
      );
      const propostas = await q(
        `SELECT pa.id, pa.versao, pa.numero, pa.proposta_em AS propostaEm, pa.situacao, pc.nome_comercial AS plano,
                v.nome AS vendedor, c.nome AS corretora,
                (SELECT COUNT(*) FROM proposta_adesao_beneficiario b WHERE b.proposta_adesao_id = pa.id
                    AND b.excluido_em IS NULL) AS vidas
           FROM proposta_adesao pa
           JOIN plano_comercializado pc ON pc.id = pa.plano_comercializado_id
           JOIN produto_plano p ON p.id = pc.produto_plano_id
           LEFT JOIN vendedor_plano v ON v.id = pa.vendedor_plano_id
           LEFT JOIN corretora_venda c ON c.id = pa.corretora_venda_id
          WHERE pa.estabelecimento_id = ? AND p.operadora_saude_id = ? AND pa.excluido_em IS NULL
          ORDER BY pa.proposta_em DESC, pa.id DESC LIMIT 300`,
        [est, op],
      );
      const metas = await q(
        `SELECT m.id, m.versao, m.descricao, m.medida, m.periodo_inicio AS inicio, m.periodo_fim AS fim, m.valor_meta AS valorMeta,
                m.situacao, m.vendedor_plano_id AS vendedor, m.equipe_venda_id AS equipe, m.corretora_venda_id AS corretora
           FROM meta_venda m WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL ORDER BY m.periodo_inicio DESC`,
        [est],
      );
      const campanhas = await q(
        `SELECT cp.id, cp.versao, cp.codigo, cp.descricao, cp.venda_inicio AS inicio, cp.venda_fim AS fim, cp.situacao,
                (SELECT COUNT(*) FROM campanha_venda_desconto d WHERE d.campanha_comercial_plano_id = cp.id
                    AND d.excluido_em IS NULL) AS descontos
           FROM campanha_comercial_plano cp WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL
          ORDER BY cp.venda_inicio DESC`,
        [est],
      );
      const lotes = await q(
        `SELECT cv.id, cv.versao, cv.numero, cv.descricao, cv.situacao, cv.valor_bruto AS bruto, cv.valor_estorno AS estorno,
                cv.valor_irrf AS irrf, cv.valor_iss AS iss, cv.valor_liquido AS liquido,
                cv.pagamento_mensalidade_inicio AS inicio, cv.pagamento_mensalidade_fim AS fim, c.nome AS corretora,
                v.nome AS vendedor
           FROM comissao_venda cv LEFT JOIN corretora_venda c ON c.id = cv.corretora_venda_id
           LEFT JOIN vendedor_plano v ON v.id = cv.vendedor_plano_id
          WHERE cv.estabelecimento_id = ? AND cv.operadora_saude_id = ? AND cv.excluido_em IS NULL ORDER BY cv.id DESC`,
        [est, op],
      );
      return {
        corretoras,
        vendedores,
        equipes,
        regras,
        incidencias,
        planos,
        contratos,
        parentescos,
        propostas,
        metas,
        campanhas,
        lotes,
      };
    });
  }

  proposta(c: ContextoPorta, id: number): Promise<PropostaLida> {
    return this.ler(c, (l, est) => lerProposta(l, est, id));
  }

  // ------------------------------------------------------------ força de venda -------------------------------------
  gravarCorretora(c: ContextoPorta, op: number, e: EntradaCorretora, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.corretora.incluir',
      'corretora_venda',
      trilha,
      async (tx, est, hoje) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        const exigePj = e.tipo === 'corretora' || e.tipo === 'administradora';
        if (exigePj && (!e.cnpj || !cnpjValido(e.cnpj)))
          throw recusa('corretora-cnpj-invalido', 'Corretora e administradora precisam de CNPJ válido.', {
            campos: ['cnpj'],
          });
        if (e.tipo === 'unidade_venda' && e.corretoraPai === null)
          throw recusa('unidade-sem-corretora', 'A unidade de venda pertence a uma corretora.', {
            campos: ['corretoraPai'],
          });
        if (e.corretoraPai !== null)
          await PortaComercialPropria.conferirAlvos(tx, est, op, { corretora: e.corretoraPai });
        const ja = await tx.uma(
          'SELECT id FROM corretora_venda WHERE operadora_saude_id = ? AND codigo = ?',
          [op, e.codigo.trim()],
        );
        if (ja)
          throw recusa('corretora-codigo-existente', 'Já existe corretora com este código.', {
            campos: ['codigo'],
          });
        let pj: number | null = null;
        if (e.cnpj) {
          const x = await tx.uma('SELECT id FROM pessoa_juridica WHERE cnpj = ?', [e.cnpj]);
          pj = x
            ? Number(x['id'])
            : await tx.incluir('pessoa_juridica', {
                cnpj: e.cnpj,
                razao_social: e.nome.trim(),
                estrangeira: false,
              });
        }
        const id = await tx.incluir('corretora_venda', {
          operadora_saude_id: op,
          codigo: e.codigo.trim(),
          nome: e.nome.trim(),
          tipo: e.tipo,
          pessoa_juridica_id: pj,
          corretora_pai_id: e.corretoraPai,
          registro_susep: e.registroSusep?.trim() || null,
          email: e.email?.trim() || null,
          credenciada_em: hoje,
          situacao: 'ativa',
        });
        return { id, versao: 1 };
      },
    );
  }

  gravarVendedor(c: ContextoPorta, op: number, e: EntradaVendedor, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.vendedor.incluir',
      'vendedor_plano',
      trilha,
      async (tx, est, hoje) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        if (!cpfValido(e.cpf))
          throw recusa('vendedor-cpf-invalido', 'O CPF do vendedor não confere.', { campos: ['cpf'] });
        await PortaComercialPropria.conferirAlvos(tx, est, op, { corretora: e.corretora });
        const ja = await tx.uma(
          'SELECT id FROM vendedor_plano WHERE estabelecimento_id = ? AND (codigo = ? OR cpf = ?)',
          [est, e.codigo.trim(), e.cpf],
        );
        if (ja)
          throw recusa('vendedor-existente', 'Já existe vendedor com este código ou CPF.', {
            campos: ['codigo', 'cpf'],
          });
        const id = await tx.incluir('vendedor_plano', {
          estabelecimento_id: est,
          codigo: e.codigo.trim(),
          nome: e.nome.trim(),
          cpf: e.cpf,
          corretora_venda_id: e.corretora,
          email: e.email?.trim() || null,
          data_cadastro: hoje,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  gravarEquipe(c: ContextoPorta, op: number, e: EntradaEquipe, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.comercial.equipe.incluir', 'equipe_venda', trilha, async (tx, est) => {
      await PortaComercialPropria.operadoraDoEst(tx, est, op);
      await PortaComercialPropria.conferirAlvos(tx, est, op, { corretora: e.corretora, vendedor: e.chefe });
      if (!e.membros.length)
        throw recusa('equipe-sem-membro', 'Inclua ao menos um vendedor.', { campos: ['membros'] });
      const vistos = new Set<number>();
      for (const m of e.membros) {
        if (vistos.has(m.vendedor))
          throw recusa('equipe-membro-repetido', 'Vendedor repetido.', { campos: ['membros'] });
        vistos.add(m.vendedor);
        await PortaComercialPropria.conferirAlvos(tx, est, op, { vendedor: m.vendedor });
      }
      const ja = await tx.uma('SELECT id FROM equipe_venda WHERE estabelecimento_id = ? AND codigo = ?', [
        est,
        e.codigo.trim(),
      ]);
      if (ja)
        throw recusa('equipe-codigo-existente', 'Já existe equipe com este código.', { campos: ['codigo'] });
      const id = await tx.incluir('equipe_venda', {
        estabelecimento_id: est,
        codigo: e.codigo.trim(),
        nome: e.nome.trim(),
        corretora_venda_id: e.corretora,
        chefe_vendedor_plano_id: e.chefe,
        ativo: true,
      });
      for (const m of e.membros)
        await tx.incluir('equipe_venda_membro', {
          equipe_venda_id: id,
          vendedor_plano_id: m.vendedor,
          vigencia_inicio: m.inicio,
        });
      return { id, versao: 1 };
    });
  }

  gravarRegra(c: ContextoPorta, op: number, e: EntradaRegra, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.regra.incluir',
      'regra_comissao_venda',
      trilha,
      async (tx, est) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        exigir(problemasDasParcelasDaRegra(e.parcelas));
        if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
          throw recusa('regra-vigencia-invalida', 'O fim da vigência vem antes do início.', {
            campos: ['vigenciaFim'],
          });
        await PortaComercialPropria.conferirAlvos(tx, est, op, e);
        if (
          !(await tx.uma('SELECT id FROM incidencia_comissao WHERE id = ? AND ativo = TRUE', [e.incidencia]))
        )
          throw recusa('incidencia-inexistente', 'Escolha a base de incidência.', { campos: ['incidencia'] });
        const ja = await tx.uma(
          'SELECT id FROM regra_comissao_venda WHERE operadora_saude_id = ? AND codigo = ?',
          [op, e.codigo.trim()],
        );
        if (ja)
          throw recusa('regra-codigo-existente', 'Já existe regra com este código.', { campos: ['codigo'] });
        const id = await tx.incluir('regra_comissao_venda', {
          operadora_saude_id: op,
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          incidencia_comissao_id: e.incidencia,
          plano_comercializado_id: e.plano,
          corretora_venda_id: e.corretora,
          equipe_venda_id: e.equipe,
          vendedor_plano_id: e.vendedor,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        let seq = 0;
        for (const p of e.parcelas)
          await tx.incluir('regra_comissao_parcela', {
            regra_comissao_venda_id: id,
            sequencia: ++seq,
            parcela_inicial: p.parcelaInicial,
            parcela_final: p.parcelaFinal,
            tipo_aplicacao: p.tipo,
            percentual: p.tipo === 'percentual' ? p.percentual : null,
            valor: p.tipo === 'valor' ? p.valor : null,
            valor_desconto: p.desconto,
            vigencia_inicio: p.vigenciaInicio,
          });
        return { id, versao: 1 };
      },
    );
  }

  // ------------------------------------------------------------ proposta -------------------------------------------
  incluirProposta(c: ContextoPorta, op: number, e: EntradaProposta, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.proposta.incluir',
      'proposta_adesao',
      trilha,
      async (tx, est, hoje) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        const plano = await tx.uma(
          `SELECT pc.id FROM plano_comercializado pc JOIN produto_plano p ON p.id = pc.produto_plano_id
          WHERE pc.id = ? AND pc.estabelecimento_id = ? AND p.operadora_saude_id = ? AND pc.situacao = 'ativo'
            AND pc.excluido_em IS NULL`,
          [e.plano, est, op],
        );
        if (!plano)
          throw recusa('plano-inexistente', 'Escolha um plano ativo da operadora.', { campos: ['plano'] });
        let contratante = e.contratante;
        if (e.contrato !== null) {
          const k = await tx.uma(
            'SELECT contratante_plano_id FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL',
            [e.contrato, est, op],
          );
          if (!k)
            throw recusa('contrato-inexistente', 'O contrato não é desta operadora.', {
              campos: ['contrato'],
            });
          contratante ??= Number(k['contratante_plano_id']);
        } else if (contratante !== null) {
          const k = await tx.uma('SELECT id FROM contratante_plano WHERE id = ? AND operadora_saude_id = ?', [
            contratante,
            op,
          ]);
          if (!k)
            throw recusa('contratante-inexistente', 'O contratante não é desta operadora.', {
              campos: ['contratante'],
            });
        } else
          throw recusa('proposta-sem-contratante', 'Informe o contrato ou o contratante.', {
            campos: ['contrato'],
          });
        await PortaComercialPropria.conferirAlvos(tx, est, op, e);
        const ficha = {
          propostaEm: e.propostaEm,
          hoje,
          diaVencimento: e.diaVencimento,
          proponentes: e.proponentes,
        };
        // O rascunho grava com a ficha incompleta, mas nunca com data futura nem vínculo quebrado.
        exigir(
          problemasDaProposta(ficha).filter((p) =>
            [
              'proposta-futura',
              'dia-vencimento-invalido',
              'dependente-sem-titular',
              'cpf-invalido',
              'cpf-repetido',
            ].includes(p.codigo),
          ),
        );
        const sexos = await lerSexos(tx);
        for (const x of e.proponentes)
          if (!sexos.has(x.sexo))
            throw recusa('sexo-invalido', 'Informe o sexo do proponente.', { campos: ['proponentes'] });
        const num = await tx.proximoNumero('proposta_adesao');
        const id = await tx.incluir('proposta_adesao', {
          estabelecimento_id: est,
          numero: num.formatado,
          proposta_em: e.propostaEm,
          contratante_plano_id: contratante,
          contrato_plano_id: e.contrato,
          plano_comercializado_id: e.plano,
          vendedor_plano_id: e.vendedor,
          corretora_venda_id: e.corretora,
          equipe_venda_id: e.equipe,
          dia_vencimento: e.diaVencimento,
          situacao: 'rascunho',
          situacao_em: new Date(),
          situacao_por_usuario_id: c.usuario ?? null,
          observacao: e.observacao?.trim() || null,
        });
        const ids = new Map<number, number>();
        for (const x of [...e.proponentes].sort(
          (a, b) => (a.tipo === 'titular' ? -1 : 0) - (b.tipo === 'titular' ? -1 : 0),
        )) {
          const bid = await tx.incluir('proposta_adesao_beneficiario', {
            proposta_adesao_id: id,
            sequencia: x.sequencia,
            tipo_beneficiario: x.tipo,
            titular_proposta_adesao_beneficiario_id:
              x.titularSequencia === null ? null : (ids.get(x.titularSequencia) ?? null),
            grau_parentesco_dependente_id: x.tipo === 'titular' ? null : x.parentesco,
            nome: x.nome.trim(),
            data_nascimento: x.nascimento,
            sexo_id: sexos.get(x.sexo),
            cpf: x.cpf || null,
            cns: x.cns || null,
            nome_mae: x.nomeMae?.trim() || null,
          });
          ids.set(x.sequencia, bid);
        }
        return { id, versao: 1, numero: num.formatado };
      },
    );
  }

  mudarProposta(c: ContextoPorta, id: number, e: MudancaPropostaEntrada, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      `operadora.comercial.proposta.${e.para}`,
      'proposta_adesao',
      trilha,
      async (tx, est, hoje) => {
        const p = await lerProposta(tx, est, id);
        const contrato = e.para === 'efetivada' ? (e.contrato ?? p.contrato) : null;
        exigir(
          problemasDaMudancaProposta({
            de: p.situacao,
            para: e.para,
            motivo: e.motivo,
            contrato,
            ficha: {
              propostaEm: p.propostaEm,
              hoje,
              diaVencimento: p.diaVencimento,
              proponentes: p.proponentes,
            },
          }),
        );
        const valores: Record<string, unknown> = {
          situacao: e.para,
          situacao_anterior: p.situacao,
          situacao_em: new Date(),
          situacao_por_usuario_id: c.usuario ?? null,
        };
        if (e.motivo?.trim())
          valores['observacao_operadora'] = [p.observacaoOperadora, `${e.para}: ${e.motivo.trim()}`]
            .filter(Boolean)
            .join('\n');
        if (e.para === 'efetivada' && contrato !== null) {
          const k = await tx.uma(
            `SELECT k.id, k.versao, k.vendedor_plano_id, k.corretora_venda_id, k.vendido_em FROM contrato_plano k
            JOIN proposta_adesao pa ON pa.id = ? WHERE k.id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL`,
            [id, contrato, est],
          );
          if (!k)
            throw recusa('contrato-inexistente', 'O contrato não existe neste estabelecimento.', {
              campos: ['contrato'],
            });
          if (p.contrato === null) valores['gerado_contrato_plano_id'] = contrato;
          // A venda fica no contrato (de onde a comissão é apurada), sem sobrescrever a venda já registrada.
          if (k['vendido_em'] === null)
            await tx.alterar('contrato_plano', contrato, Number(k['versao']), {
              vendido_em: p.propostaEm,
              vendedor_plano_id: idOuNulo(k['vendedor_plano_id']) ?? p.vendedor,
              corretora_venda_id: idOuNulo(k['corretora_venda_id']) ?? p.corretora,
            });
        }
        const versao = await tx.alterar('proposta_adesao', id, e.versao, valores);
        return { id, versao };
      },
    );
  }

  // ------------------------------------------------------------ meta -----------------------------------------------
  gravarMeta(c: ContextoPorta, op: number, e: EntradaMeta, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.comercial.meta.incluir', 'meta_venda', trilha, async (tx, est) => {
      await PortaComercialPropria.operadoraDoEst(tx, est, op);
      exigir(problemasDaMeta(e));
      await PortaComercialPropria.conferirAlvos(tx, est, op, e);
      const id = await tx.incluir('meta_venda', {
        estabelecimento_id: est,
        descricao: e.descricao.trim(),
        medida: e.medida,
        periodo_inicio: e.inicio,
        periodo_fim: e.fim,
        equipe_venda_id: e.equipe,
        vendedor_plano_id: e.vendedor,
        corretora_venda_id: e.corretora,
        valor_meta: e.valorMeta,
        situacao: 'vigente',
      });
      let seq = 0;
      for (const f of [...e.faixas].sort((a, b) => a.de - b.de))
        await tx.incluir('meta_venda_item', {
          meta_venda_id: id,
          sequencia: ++seq,
          faixa_inicial: f.de,
          faixa_final: f.ate,
          percentual_premio: f.percentualPremio,
          valor_premio: f.valorPremio,
        });
      return { id, versao: 1 };
    });
  }

  /** O realizado da meta no período pelo alvo (vendedor, equipe pelos membros, corretora) e a faixa de prêmio. */
  apurarMeta(c: ContextoPorta, id: number): Promise<ResultadoMeta & { medida: MedidaMeta }> {
    return this.ler(c, async (l, est) => {
      const m = await l.uma(
        `SELECT medida, periodo_inicio, periodo_fim, valor_meta, vendedor_plano_id, equipe_venda_id, corretora_venda_id
           FROM meta_venda WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      if (!m) throw naoEncontrado();
      const faixas = (
        await l.consultar(
          `SELECT faixa_inicial, faixa_final, percentual_premio, valor_premio FROM meta_venda_item
            WHERE meta_venda_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [id],
        )
      ).map((f) => ({
        de: n(f['faixa_inicial']),
        ate: numero(f['faixa_final']),
        percentualPremio: numero(f['percentual_premio']),
        valorPremio: numero(f['valor_premio']),
      }));
      const ini = dataIso(m['periodo_inicio']);
      const fim = dataIso(m['periodo_fim']);
      const conds = ['pa.estabelecimento_id = ?', 'pa.excluido_em IS NULL', 'pa.proposta_em BETWEEN ? AND ?'];
      const ps: unknown[] = [est, ini, fim];
      const alvo = (col: string, v: unknown) => {
        if (v === null || v === undefined) return;
        conds.push(`${col} = ?`);
        ps.push(Number(v));
      };
      alvo('pa.vendedor_plano_id', m['vendedor_plano_id']);
      alvo('pa.corretora_venda_id', m['corretora_venda_id']);
      if (m['equipe_venda_id'] !== null && m['equipe_venda_id'] !== undefined) {
        conds.push(
          `(pa.equipe_venda_id = ? OR pa.vendedor_plano_id IN (SELECT vendedor_plano_id FROM equipe_venda_membro
             WHERE equipe_venda_id = ? AND excluido_em IS NULL))`,
        );
        ps.push(Number(m['equipe_venda_id']), Number(m['equipe_venda_id']));
      }
      const medida = textoObrigatorio(m['medida']) as MedidaMeta;
      const where = conds.join(' AND ');
      let realizado: number;
      if (medida === 'propostas') {
        const r = await l.uma(
          `SELECT COUNT(*) AS v FROM proposta_adesao pa WHERE ${where} AND pa.situacao NOT IN ('rascunho','recusada','cancelada')`,
          ps,
        );
        realizado = n(r?.['v']);
      } else if (medida === 'contratos') {
        const r = await l.uma(
          `SELECT COUNT(DISTINCT COALESCE(pa.gerado_contrato_plano_id, pa.contrato_plano_id)) AS v FROM proposta_adesao pa
            WHERE ${where} AND pa.situacao = 'efetivada'`,
          ps,
        );
        realizado = n(r?.['v']);
      } else if (medida === 'vidas') {
        const r = await l.uma(
          `SELECT COUNT(*) AS v FROM proposta_adesao_beneficiario b JOIN proposta_adesao pa ON pa.id = b.proposta_adesao_id
            WHERE ${where} AND pa.situacao = 'efetivada' AND b.excluido_em IS NULL`,
          ps,
        );
        realizado = n(r?.['v']);
      } else {
        const r = await l.uma(
          `SELECT COALESCE(SUM(f.valor_pago), 0) AS v FROM fatura_plano f
            WHERE f.tipo_fatura = 'mensalidade' AND f.situacao IN ('paga','paga_parcial') AND f.excluido_em IS NULL
              AND f.data_pagamento BETWEEN ? AND ?
              AND f.contrato_plano_id IN (SELECT COALESCE(pa.gerado_contrato_plano_id, pa.contrato_plano_id)
                    FROM proposta_adesao pa WHERE ${where} AND pa.situacao = 'efetivada')`,
          [ini, fim, ...ps],
        );
        realizado = n(r?.['v']);
      }
      return { medida, ...apurarMeta({ valorMeta: numero(m['valor_meta']), faixas }, realizado) };
    });
  }

  // ------------------------------------------------------------ campanha -------------------------------------------
  gravarCampanha(c: ContextoPorta, op: number, e: EntradaCampanha, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.campanha.incluir',
      'campanha_comercial_plano',
      trilha,
      async (tx, est) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        exigir(problemasDaCampanha(e));
        if (
          e.regra !== null &&
          !(await tx.uma('SELECT id FROM regra_comissao_venda WHERE id = ? AND operadora_saude_id = ?', [
            e.regra,
            op,
          ]))
        )
          throw recusa('regra-inexistente', 'A regra de comissão não é desta operadora.', {
            campos: ['regra'],
          });
        for (const p of e.participantes) await PortaComercialPropria.conferirAlvos(tx, est, op, p);
        const ja = await tx.uma(
          'SELECT id FROM campanha_comercial_plano WHERE estabelecimento_id = ? AND codigo = ?',
          [est, e.codigo.trim()],
        );
        if (ja)
          throw recusa('campanha-codigo-existente', 'Já existe campanha com este código.', {
            campos: ['codigo'],
          });
        const id = await tx.incluir('campanha_comercial_plano', {
          estabelecimento_id: est,
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          venda_inicio: e.inicio,
          venda_fim: e.fim,
          regra_comissao_venda_id: e.regra,
          condicoes: e.condicoes?.trim() || null,
          situacao: 'planejada',
        });
        let seq = 0;
        for (const d of e.descontos)
          await tx.incluir('campanha_venda_desconto', {
            campanha_comercial_plano_id: id,
            sequencia: ++seq,
            tipo_desconto: 'parcela',
            numero_parcela: d.parcela,
            percentual: d.percentual,
            valor: d.valor,
          });
        const parts = e.participantes.length
          ? e.participantes
          : [{ corretora: null, equipe: null, vendedor: null }];
        for (const p of parts)
          await tx.incluir('campanha_venda_participante', {
            campanha_comercial_plano_id: id,
            corretora_venda_id: p.corretora,
            equipe_venda_id: p.equipe,
            vendedor_plano_id: p.vendedor,
            todos_participantes: p.corretora === null && p.equipe === null && p.vendedor === null,
          });
        return { id, versao: 1 };
      },
    );
  }

  mudarCampanha(
    c: ContextoPorta,
    id: number,
    e: { versao: number; para: SituacaoCampanha },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      `operadora.comercial.campanha.${e.para}`,
      'campanha_comercial_plano',
      trilha,
      async (tx, est) => {
        const r = await tx.uma(
          `SELECT situacao, (SELECT COUNT(*) FROM campanha_venda_desconto d WHERE d.campanha_comercial_plano_id = cp.id
                AND d.excluido_em IS NULL) AS descontos
           FROM campanha_comercial_plano cp WHERE cp.id = ? AND cp.estabelecimento_id = ? AND cp.excluido_em IS NULL`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        exigir(
          problemasDaMudancaCampanha(
            textoObrigatorio(r['situacao']) as SituacaoCampanha,
            e.para,
            n(r['descontos']),
          ),
        );
        const versao = await tx.alterar('campanha_comercial_plano', id, e.versao, { situacao: e.para });
        return { id, versao };
      },
    );
  }

  // ------------------------------------------------------------ comissão -------------------------------------------
  apurarComissao(c: ContextoPorta, op: number, e: EntradaApuracao, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.comercial.comissao.apurar',
      'comissao_venda',
      trilha,
      async (tx, est, hoje) => {
        await PortaComercialPropria.operadoraDoEst(tx, est, op);
        await PortaComercialPropria.conferirAlvos(tx, est, op, e);
        if (e.pagamentoFim < e.pagamentoInicio)
          throw recusa('comissao-periodo-invalido', 'O fim do período vem antes do início.', {
            campos: ['pagamentoFim'],
          });
        const regra = await tx.uma(
          'SELECT id FROM regra_comissao_venda WHERE id = ? AND operadora_saude_id = ? AND ativo = TRUE',
          [e.regra, op],
        );
        if (!regra)
          throw recusa('regra-inexistente', 'Escolha uma regra de comissão ativa.', { campos: ['regra'] });
        const parcelas = await lerParcelas(tx, e.regra);
        // Contratos vendidos da operadora, pelo alvo do lote (corretora, vendedor ou membros da equipe).
        const conds = [
          'k.estabelecimento_id = ?',
          'k.operadora_saude_id = ?',
          'k.excluido_em IS NULL',
          'k.gera_comissao = TRUE',
          'k.vendido_em IS NOT NULL',
        ];
        const ps: unknown[] = [est, op];
        if (e.corretora !== null) {
          conds.push('k.corretora_venda_id = ?');
          ps.push(e.corretora);
        }
        if (e.vendedor !== null) {
          conds.push('k.vendedor_plano_id = ?');
          ps.push(e.vendedor);
        }
        if (e.equipe !== null) {
          conds.push(
            'k.vendedor_plano_id IN (SELECT vendedor_plano_id FROM equipe_venda_membro WHERE equipe_venda_id = ? AND excluido_em IS NULL)',
          );
          ps.push(e.equipe);
        }
        const contratos = await tx.consultar(
          `SELECT k.id, k.vendido_em, k.inicio_vigencia, k.situacao, k.fim_vigencia, k.alterado_em, k.corretora_venda_id,
                k.vendedor_plano_id
           FROM contrato_plano k WHERE ${conds.join(' AND ')}`,
          ps,
          { teto: 5000 },
        );
        if (!contratos.length)
          throw recusa('comissao-sem-movimento', 'Nenhum contrato vendido para este filtro.');
        const info = new Map(contratos.map((k) => [Number(k['id']), k]));
        const ids = [...info.keys()];
        const m = marcadores(ids.length);
        const faturas = await tx.consultar(
          `SELECT f.id, f.contrato_plano_id, f.competencia, f.valor_total, f.valor_pago, f.data_pagamento, f.situacao,
                COALESCE(f.parcela, TIMESTAMPDIFF(MONTH, DATE_FORMAT(k.inicio_vigencia, '%Y-%m-01'), f.competencia) + 1) AS parcela,
                EXISTS (SELECT 1 FROM comissao_venda_item i JOIN comissao_venda cv ON cv.id = i.comissao_venda_id
                         WHERE i.fatura_plano_id = f.id AND i.tipo_lancamento = 'comissao' AND i.cancelado = FALSE
                           AND cv.situacao <> 'cancelada') AS comissionada,
                EXISTS (SELECT 1 FROM comissao_venda_item i JOIN comissao_venda cv ON cv.id = i.comissao_venda_id
                         WHERE i.fatura_plano_id = f.id AND i.tipo_lancamento = 'pendencia' AND i.cancelado = FALSE
                           AND cv.situacao <> 'cancelada') AS pendencia
           FROM fatura_plano f JOIN contrato_plano k ON k.id = f.contrato_plano_id
          WHERE f.estabelecimento_id = ? AND f.contrato_plano_id IN (${m}) AND f.tipo_fatura = 'mensalidade'
            AND f.situacao <> 'cancelada' AND f.excluido_em IS NULL
            AND ((f.data_pagamento BETWEEN ? AND ? AND f.valor_pago > 0)
              OR (f.data_pagamento IS NULL AND f.data_vencimento BETWEEN ? AND ?))`,
          [est, ...ids, e.pagamentoInicio, e.pagamentoFim, e.pagamentoInicio, e.pagamentoFim],
          { teto: 20000 },
        );
        const mensalidades: MensalidadeComissionavel[] = faturas
          .filter((f) => !(f['data_pagamento'] === null && booleano(f['pendencia'])))
          .map((f) => ({
            fatura: Number(f['id']),
            contrato: Number(f['contrato_plano_id']),
            numeroParcela: Math.max(1, n(f['parcela'])),
            competencia: dataIso(f['competencia']) ?? '',
            valor: n(f['valor_total']),
            valorPago: numero(f['valor_pago']),
            pagoEm: dataIso(f['data_pagamento']),
            vendidoEm: dataIso(info.get(Number(f['contrato_plano_id']))?.['vendido_em']) ?? '',
            jaComissionada: booleano(f['comissionada']),
          }));
        const itens = apurarComissoes(mensalidades, parcelas);
        // Saídas: contrato encerrado (cancelamento) ou com mensalidade vencida há mais de 60 dias (inadimplência).
        const saidas: SaidaContrato[] = [];
        for (const id of ids) {
          const k = info.get(id)!;
          let motivo: SaidaContrato['motivo'] | null = null;
          let saidaEm: string | null;
          if (textoObrigatorio(k['situacao']) === 'encerrado') {
            motivo = 'cancelamento';
            saidaEm = dataIso(k['fim_vigencia']) ?? dataIso(k['alterado_em']) ?? hoje;
          } else {
            const venc = await tx.consultar(
              `SELECT data_vencimento FROM fatura_plano WHERE contrato_plano_id = ? AND tipo_fatura = 'mensalidade'
                AND situacao IN ('aberta','emitida') AND excluido_em IS NULL AND data_vencimento < ?`,
              [id, hoje],
              { teto: 500 },
            );
            saidaEm = inadimplenteDesde(
              venc.map((v) => dataIso(v['data_vencimento']) ?? hoje),
              hoje,
            );
            if (saidaEm) motivo = 'inadimplencia';
          }
          if (!motivo || !saidaEm) continue;
          const pago = await tx.uma(
            `SELECT COALESCE(SUM(CASE WHEN i.tipo_lancamento = 'comissao' AND cv.situacao IN ('fechada','paga') THEN i.valor_comissao ELSE 0 END), 0) AS pago,
                  SUM(CASE WHEN i.tipo_lancamento = 'estorno' THEN 1 ELSE 0 END) AS estornos
             FROM comissao_venda_item i JOIN comissao_venda cv ON cv.id = i.comissao_venda_id
            WHERE i.contrato_plano_id = ? AND i.cancelado = FALSE AND cv.situacao <> 'cancelada'`,
            [id],
          );
          saidas.push({
            contrato: id,
            motivo,
            saidaEm,
            vendidoEm: dataIso(k['vendido_em']) ?? saidaEm,
            comissaoPaga: n(pago?.['pago']),
            jaEstornado: n(pago?.['estornos']) > 0,
          });
        }
        const estornos = apurarEstornos(saidas, e.prazoEstornoDias);
        if (!itens.length && !estornos.length)
          throw recusa(
            'comissao-sem-movimento',
            'Nada a apurar: nenhuma parcela paga nem estorno no período.',
          );
        const totais = totaisDaComissao(
          [...itens, ...estornos.map((x) => ({ valor: x.valor, pendente: false }))],
          { irrf: e.aliquotaIrrf, iss: e.aliquotaIss },
        );
        const num = await tx.proximoNumero('comissao_venda');
        const id = await tx.incluir('comissao_venda', {
          estabelecimento_id: est,
          operadora_saude_id: op,
          numero: num.formatado,
          descricao: e.descricao?.trim() || null,
          corretora_venda_id: e.corretora,
          equipe_venda_id: e.equipe,
          vendedor_plano_id: e.vendedor,
          pagamento_mensalidade_inicio: e.pagamentoInicio,
          pagamento_mensalidade_fim: e.pagamentoFim,
          valor_bruto: totais.bruto,
          valor_estorno: totais.estorno,
          valor_irrf: totais.irrf,
          valor_iss: totais.iss,
          valor_liquido: totais.liquido,
          situacao: 'calculada',
        });
        let seq = 0;
        for (const i of itens) {
          const k = info.get(i.contrato)!;
          await tx.incluir('comissao_venda_item', {
            comissao_venda_id: id,
            sequencia: ++seq,
            tipo_lancamento: i.tipo,
            contrato_plano_id: i.contrato,
            fatura_plano_id: i.fatura,
            corretora_venda_id: idOuNulo(k['corretora_venda_id']),
            vendedor_plano_id: idOuNulo(k['vendedor_plano_id']),
            regra_comissao_venda_id: e.regra,
            numero_parcela: i.numeroParcela,
            competencia: i.competencia || null,
            vendido_em: dataIso(k['vendido_em']),
            valor_base: i.base,
            percentual: i.percentual,
            valor_comissao: i.valor,
            pendente: i.pendente,
          });
        }
        for (const x of estornos) {
          const k = info.get(x.contrato)!;
          await tx.incluir('comissao_venda_item', {
            comissao_venda_id: id,
            sequencia: ++seq,
            tipo_lancamento: 'estorno',
            contrato_plano_id: x.contrato,
            corretora_venda_id: idOuNulo(k['corretora_venda_id']),
            vendedor_plano_id: idOuNulo(k['vendedor_plano_id']),
            regra_comissao_venda_id: e.regra,
            vendido_em: dataIso(k['vendido_em']),
            valor_comissao: x.valor,
            dias_permanencia: x.diasPermanencia,
            observacao:
              x.motivo === 'cancelamento'
                ? 'Estorno por cancelamento do contrato'
                : 'Estorno por inadimplência',
          });
        }
        return { id, versao: 1, numero: num.formatado, liquido: totais.liquido };
      },
    );
  }

  itensComissao(c: ContextoPorta, id: number): Promise<ItemLista[]> {
    return this.ler(c, async (l, est) => {
      if (!(await l.uma('SELECT id FROM comissao_venda WHERE id = ? AND estabelecimento_id = ?', [id, est])))
        throw naoEncontrado();
      return (
        await l.consultar(
          `SELECT i.id, i.sequencia, i.tipo_lancamento AS tipo, k.numero AS contrato, i.numero_parcela AS parcela,
                  i.competencia, i.valor_base AS base, i.percentual, i.valor_comissao AS valor, i.pendente, i.cancelado,
                  i.dias_permanencia AS diasPermanencia, i.observacao
             FROM comissao_venda_item i LEFT JOIN contrato_plano k ON k.id = i.contrato_plano_id
            WHERE i.comissao_venda_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
          [id],
          { teto: 20000 },
        )
      ).map(linha);
    });
  }

  mudarComissao(
    c: ContextoPorta,
    id: number,
    e: { versao: number; para: SituacaoComissao; motivo: string | null },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      `operadora.comercial.comissao.${e.para}`,
      'comissao_venda',
      trilha,
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT situacao FROM comissao_venda WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        );
        if (!r) throw naoEncontrado();
        const de = textoObrigatorio(r['situacao']) as SituacaoComissao;
        exigir(problemasDaMudancaComissao(de, e.para, e.motivo));
        const v: Record<string, unknown> = { situacao: e.para };
        if (e.para === 'fechada') v['fechada_em'] = new Date();
        if (de === 'fechada' && e.para === 'calculada') {
          v['reaberta_em'] = new Date();
          v['reaberta_por_usuario_id'] = c.usuario ?? null;
          v['fechada_em'] = null;
        }
        if (e.motivo?.trim()) v['descricao'] = `${e.para}: ${e.motivo.trim()}`.slice(0, 150);
        if (e.para === 'cancelada') {
          // Os itens ficam, marcados como cancelados: a parcela volta a poder ser comissionada.
          const itens = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM comissao_venda_item WHERE comissao_venda_id = ?',
            [id],
            {
              teto: 20000,
            },
          );
          for (const i of itens)
            await tx.alterar('comissao_venda_item', Number(i['id']), Number(i['versao']), {
              cancelado: true,
            });
        }
        const versao = await tx.alterar('comissao_venda', id, e.versao, v);
        return { id, versao };
      },
    );
  }
}

// ---------------------------------------------------------------- apoio ----------------------------------------------
async function lerParcelas(l: Leitor, regra: number): Promise<ParcelaRegraComissao[]> {
  const rs = await l.consultar(
    `SELECT parcela_inicial, parcela_final, tipo_aplicacao, percentual, valor, valor_desconto, vigencia_inicio
       FROM regra_comissao_parcela WHERE regra_comissao_venda_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [regra],
    { teto: 200 },
  );
  return rs.map((r) => ({
    parcelaInicial: n(r['parcela_inicial']),
    parcelaFinal: numero(r['parcela_final']),
    tipo: textoObrigatorio(r['tipo_aplicacao']) === 'valor' ? 'valor' : 'percentual',
    percentual: numero(r['percentual']),
    valor: numero(r['valor']),
    desconto: numero(r['valor_desconto']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
  }));
}

async function lerSexos(l: Leitor): Promise<Map<string, number>> {
  const rs = await l.consultar('SELECT id, sigla FROM sexo WHERE ativo = TRUE ORDER BY id', [], { teto: 50 });
  const m = new Map<string, number>();
  for (const r of rs) {
    const s = textoObrigatorio(r['sigla']);
    if (!m.has(s)) m.set(s, Number(r['id']));
  }
  return m;
}

async function lerProposta(l: Leitor, est: number, id: number): Promise<PropostaLida> {
  const p = await l.uma(
    `SELECT id, versao, numero, situacao, proposta_em, plano_comercializado_id, contrato_plano_id, gerado_contrato_plano_id,
            vendedor_plano_id, corretora_venda_id, equipe_venda_id, dia_vencimento, observacao, observacao_operadora
       FROM proposta_adesao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!p) throw naoEncontrado();
  const bs = await l.consultar(
    `SELECT b.id, b.sequencia, b.tipo_beneficiario, t.sequencia AS titular_seq, b.grau_parentesco_dependente_id, b.nome,
            b.data_nascimento, s.sigla, b.cpf, b.cns, b.nome_mae
       FROM proposta_adesao_beneficiario b JOIN sexo s ON s.id = b.sexo_id
       LEFT JOIN proposta_adesao_beneficiario t ON t.id = b.titular_proposta_adesao_beneficiario_id
      WHERE b.proposta_adesao_id = ? AND b.excluido_em IS NULL ORDER BY b.sequencia`,
    [id],
    { teto: 500 },
  );
  return {
    id,
    versao: Number(p['versao']),
    numero: textoObrigatorio(p['numero']),
    situacao: textoObrigatorio(p['situacao']) as SituacaoProposta,
    propostaEm: dataIso(p['proposta_em']) ?? '',
    plano: Number(p['plano_comercializado_id']),
    contrato: idOuNulo(p['contrato_plano_id']),
    contratoGerado: idOuNulo(p['gerado_contrato_plano_id']),
    vendedor: idOuNulo(p['vendedor_plano_id']),
    corretora: idOuNulo(p['corretora_venda_id']),
    equipe: idOuNulo(p['equipe_venda_id']),
    diaVencimento: numero(p['dia_vencimento']),
    observacao: texto(p['observacao']),
    observacaoOperadora: texto(p['observacao_operadora']),
    proponentes: bs.map((b) => ({
      sequencia: n(b['sequencia']),
      tipo: textoObrigatorio(b['tipo_beneficiario']) as TipoProponente,
      titularSequencia: numero(b['titular_seq']),
      parentesco: idOuNulo(b['grau_parentesco_dependente_id']),
      nome: textoObrigatorio(b['nome']),
      nascimento: dataIso(b['data_nascimento']) ?? '',
      sexo: textoObrigatorio(b['sigla']),
      cpf: texto(b['cpf']),
      cns: texto(b['cns']),
      nomeMae: texto(b['nome_mae']),
    })),
  };
}
