// Central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012) no banco do cliente, pelo @sgh/nucleo,
// sempre no estabelecimento da sessão. Regras em @sgh/dominio-cirurgia (cme). Contrato de efeito:
//   - caixa: cria a caixa de instrumental com as peças em ordem de montagem (caixa_instrumental e _item);
//   - equipamento: cadastra a autoclave ou outro equipamento de esterilização do estabelecimento;
//   - solicitação: o setor ou a cirurgia (agendamento) pede caixas à CME (solicitacao_material_esteril e _item, número
//     pela sequência do estabelecimento);
//   - pacote: prepara o pacote da caixa (pacote_esteril em "aguardando_esterilizacao", com o código da etiqueta e o
//     conteúdo copiado do modelo da caixa em pacote_esteril_conteudo); ligado ao item da solicitação, que fica "em
//     processamento";
//   - ciclo: abre a carga no equipamento (ciclo_esterilizacao "em_andamento" com número e lote; ciclo_esterilizacao_item
//     por pacote; pacote ligado ao ciclo), sob a trava de cada pacote;
//   - concluir: grava parâmetros e indicadores; o domínio decide liberado (pacotes estéreis com data e validade, item
//     da solicitação "pronto", contador de reprocessamentos da caixa), reprovado (pacotes rejeitados, nada apagado) ou
//     concluído aguardando o biológico (carga com implante); liberar resolve o concluído;
//   - entregar: o pacote estéril sai para a cirurgia (movimento_material_esteril "entrega" com o agendamento e o
//     atendimento; pacote "distribuido"; item da solicitação "entregue" e a solicitação pela regra);
//   - usar: o pacote entregue é aberto na cirurgia (pacote "usado"; o movimento fica conferido);
//   - rastreio: do código da etiqueta ao ciclo (lote, indicadores, liberação), à cirurgia e ao paciente; e, pela
//     cirurgia, os pacotes entregues e usados nela (visão por paciente).
// Recusa da regra: 422, sem escrita. Outro estabelecimento: 404.
import {
  caixaReprocessavel,
  codigoEtiqueta,
  conferirCaixa,
  conferirCarga,
  conferirEntrega,
  conferirUso,
  type DesfechoCiclo,
  desfechoDaLiberacao,
  desfechoDoCiclo,
  diasDeValidade,
  faltasDaEtiqueta,
  type ProblemaCme,
  situacaoDaSolicitacao,
  validadeDoPacote,
} from '@sgh/dominio-cirurgia';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_CME = Symbol('PORTA_CME');

export const TABELAS_CME = [
  'caixa_instrumental',
  'caixa_instrumental_item',
  'equipamento_esterilizacao',
  'solicitacao_material_esteril',
  'solicitacao_material_esteril_item',
  'pacote_esteril',
  'pacote_esteril_conteudo',
  'ciclo_esterilizacao',
  'ciclo_esterilizacao_item',
  'movimento_material_esteril',
  'movimento_material_esteril_item',
  'sequencia_negocio',
] as const;

type Linha = Record<string, unknown>;
type Fonte = Pick<Leitor, 'consultar' | 'uma'>;

const id = z.number().int().positive();
const indicador = z.enum(['conforme', 'nao_conforme', 'pendente']);
const instanteTela = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

const esquemaCaixa = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    validadeDias: z.number().int().nullable().default(null),
    controlaReprocessamentos: z.boolean().default(false),
    limiteReprocessamentos: z.number().int().positive().nullable().default(null),
    metodo: id.nullable().default(null),
    itens: z
      .array(
        z
          .object({
            insumo: id.nullable().default(null),
            produto: id.nullable().default(null),
            quantidade: z.number().positive(),
            pecaMestre: z.boolean().default(false),
          })
          .strict(),
      )
      .max(300),
  })
  .strict();
const esquemaEquipamento = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    natureza: z.enum([
      'autoclave',
      'termodesinfectora',
      'lavadora_ultrassonica',
      'lavadora',
      'peroxido_hidrogenio',
      'oxido_etileno',
      'outro',
    ]),
    metodo: id.nullable().default(null),
  })
  .strict();
const esquemaSolicitacao = z
  .object({
    tipo: z.enum(['setor', 'cirurgia']),
    setor: id,
    agendamento: id.nullable().default(null),
    urgente: z.boolean().default(false),
    necessarioAte: instanteTela.nullable().default(null),
    itens: z
      .array(z.object({ caixa: id, quantidade: z.number().int().positive().max(50) }).strict())
      .min(1)
      .max(50),
  })
  .strict();
const esquemaPacote = z
  .object({ caixa: id, solicitacaoItem: id.nullable().default(null), embalagem: id.nullable().default(null) })
  .strict();
const esquemaCiclo = z.object({ equipamento: id, metodo: id, pacotes: z.array(id).max(200) }).strict();
const esquemaConcluir = z
  .object({
    versao: id,
    temperatura: z.number().min(0).max(999).nullable().default(null),
    pressao: z.number().min(0).max(99999).nullable().default(null),
    tempoExposicao: z.number().int().min(0).max(1440).nullable().default(null),
    fisico: indicador,
    quimico: indicador,
    biologico: indicador,
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaLiberar = z.object({ versao: id, biologico: indicador }).strict();
const esquemaEntregar = z.object({ agendamento: id, cme: id, setor: id }).strict();
const esquemaUsar = z.object({ agendamento: id }).strict();

const recusa = (titulo: string, p: readonly ProblemaCme[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : null;
const dia = (v: unknown): string | null => (v ? (instante(v) ?? '').slice(0, 10) || null : null);
const hojeNo = (fuso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());

export interface CaixaLida {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly validadeDias: number | null;
  readonly reprocessamentos: number;
  readonly limite: number | null;
  readonly pecas: number;
}

export interface PacoteLido {
  readonly id: number;
  readonly etiqueta: string;
  readonly caixa: number | null;
  readonly produto: string;
  readonly situacao: string;
  readonly ciclo: number | null;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly versao: number;
}

export interface CicloLido {
  readonly id: number;
  readonly numero: string;
  readonly lote: string;
  readonly equipamento: string;
  readonly metodo: string;
  readonly situacao: string;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly fisico: boolean;
  readonly quimico: boolean;
  readonly biologico: boolean;
  readonly pacotes: number;
  readonly versao: number;
}

export interface PainelCme {
  readonly setores: { id: number; nome: string }[];
  readonly unidades: { id: number; nome: string }[];
  /** Cirurgias marcadas de hoje em diante (para pedir material e entregar o pacote). */
  readonly agendamentos: { id: number; numero: string; paciente: string; inicio: string | null }[];
  readonly caixas: CaixaLida[];
  readonly equipamentos: { id: number; codigo: string; descricao: string; metodo: number | null }[];
  readonly metodos: { id: number; codigo: string; descricao: string }[];
  readonly pacotes: PacoteLido[];
  readonly ciclos: CicloLido[];
  readonly solicitacoes: {
    id: number;
    numero: string;
    tipo: string;
    situacao: string;
    agendamento: number | null;
    itens: { id: number; caixa: number; quantidade: number; situacao: string; pacote: number | null }[];
  }[];
}

export interface RastreioPacote {
  readonly pacote: PacoteLido & {
    readonly esterilizadoEm: string | null;
    readonly preparadoPor: string | null;
    readonly metodo: string | null;
    readonly faltasEtiqueta: string[];
  };
  readonly ciclo: CicloLido | null;
  readonly cirurgias: {
    readonly movimento: number;
    readonly agendamento: number | null;
    readonly agendamentoNumero: string | null;
    readonly atendimento: number | null;
    readonly paciente: number | null;
    readonly pacienteNome: string | null;
    readonly entregueEm: string | null;
    readonly usado: boolean;
  }[];
}

const SQL_PACOTES = `
  SELECT p.id, p.codigo_etiqueta, p.caixa_instrumental_id, p.situacao, p.ciclo_esterilizacao_id, p.validade, p.versao,
         p.esterilizado_em, p.metodo_esterilizacao_id, c.numero_lote, c.situacao AS ciclo_situacao,
         COALESCE(cx.descricao, '') AS produto, cx.validade_esterilizacao_dias, cx.ativo AS caixa_ativa,
         cx.controla_reprocessamentos, cx.limite_reprocessamentos, cx.quantidade_reprocessamentos,
         te.validade_dias AS embalagem_dias, m.descricao AS metodo_nome, u.login AS preparado_por
    FROM pacote_esteril p
    LEFT JOIN ciclo_esterilizacao c ON c.id = p.ciclo_esterilizacao_id
    LEFT JOIN caixa_instrumental cx ON cx.id = p.caixa_instrumental_id
    LEFT JOIN tipo_embalagem_esteril te ON te.id = p.tipo_embalagem_esteril_id
    LEFT JOIN metodo_esterilizacao m ON m.id = COALESCE(c.metodo_esterilizacao_id, p.metodo_esterilizacao_id)
    LEFT JOIN usuario u ON u.id = p.preparado_por_usuario_id
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

const SQL_CICLOS = `
  SELECT c.id, c.numero, c.numero_lote, c.situacao, c.inicio_em, c.fim_em, c.indicador_fisico, c.indicador_quimico,
         c.indicador_biologico, c.versao, e.descricao AS equipamento, m.descricao AS metodo,
         (SELECT COUNT(*) FROM ciclo_esterilizacao_item i
           WHERE i.ciclo_esterilizacao_id = c.id AND i.excluido_em IS NULL) AS pacotes
    FROM ciclo_esterilizacao c
    JOIN equipamento_esterilizacao e ON e.id = c.equipamento_esterilizacao_id
    JOIN metodo_esterilizacao m ON m.id = c.metodo_esterilizacao_id
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const pacoteLido = (r: Linha): PacoteLido => ({
  id: num(r['id']),
  etiqueta: String(r['codigo_etiqueta']),
  caixa: numOuNull(r['caixa_instrumental_id']),
  produto: String(r['produto'] ?? ''),
  situacao: String(r['situacao']),
  ciclo: numOuNull(r['ciclo_esterilizacao_id']),
  lote: txtOuNull(r['numero_lote']),
  validade: dia(r['validade']),
  versao: num(r['versao']),
});

const cicloLido = (r: Linha): CicloLido => ({
  id: num(r['id']),
  numero: String(r['numero']),
  lote: String(r['numero_lote']),
  equipamento: String(r['equipamento']),
  metodo: String(r['metodo']),
  situacao: String(r['situacao']),
  inicio: instante(r['inicio_em']),
  fim: instante(r['fim_em']),
  fisico: bool(r['indicador_fisico']),
  quimico: bool(r['indicador_quimico']),
  biologico: bool(r['indicador_biologico']),
  pacotes: num(r['pacotes']),
  versao: num(r['versao']),
});

export class PortaCmePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS_CME, 'cirurgia.cme');
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoPortaPropria): Promise<PainelCme> {
    return this.ler(c, 'painel', async (l, est) => {
      const caixas = await l.consultar(
        `SELECT cx.id, cx.codigo, cx.descricao, cx.validade_esterilizacao_dias, cx.quantidade_reprocessamentos,
                cx.limite_reprocessamentos,
                (SELECT COUNT(*) FROM caixa_instrumental_item i
                  WHERE i.caixa_instrumental_id = cx.id AND i.excluido_em IS NULL) AS pecas
           FROM caixa_instrumental cx
          WHERE cx.estabelecimento_id = ? AND cx.excluido_em IS NULL AND cx.ativo = TRUE
          ORDER BY cx.descricao LIMIT 500`,
        [est.id],
      );
      const equipamentos = await l.consultar(
        `SELECT id, codigo, descricao, metodo_esterilizacao_id FROM equipamento_esterilizacao
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE ORDER BY descricao`,
        [est.id],
      );
      const metodos = await l.consultar(
        `SELECT id, codigo, descricao FROM metodo_esterilizacao
          WHERE ativo = TRUE AND categoria = 'esterilizacao' ORDER BY descricao`,
      );
      const pacotes = await l.consultar(
        `${SQL_PACOTES} AND (p.situacao IN ('em_preparo', 'aguardando_esterilizacao', 'esteril', 'distribuido')
             OR p.preparado_em >= NOW() - INTERVAL 7 DAY)
          ORDER BY p.id DESC LIMIT 300`,
        [est.id],
      );
      const ciclos = await l.consultar(`${SQL_CICLOS} ORDER BY c.inicio_em DESC LIMIT 50`, [est.id]);
      const sols = await l.consultar(
        `SELECT s.id, s.numero, s.tipo, s.situacao, s.agendamento_cirurgico_id
           FROM solicitacao_material_esteril s
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
            AND s.situacao IN ('aberta', 'recebida_cme', 'em_processamento', 'pronta', 'parcial')
          ORDER BY s.solicitado_em LIMIT 100`,
        [est.id],
      );
      const itens = sols.length
        ? await l.consultar(
            `SELECT id, solicitacao_material_esteril_id AS sol, caixa_instrumental_id, quantidade, situacao,
                    pacote_esteril_id
               FROM solicitacao_material_esteril_item
              WHERE excluido_em IS NULL AND solicitacao_material_esteril_id IN (${sols.map(() => '?').join(', ')})
              ORDER BY sequencia`,
            sols.map((s) => s['id']),
          )
        : [];
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 300',
        [est.id],
      );
      const unidades = await l.consultar(
        'SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 300',
        [est.id],
      );
      const ags = await l.consultar(
        `SELECT a.id, a.numero, a.inicio_previsto_em, pf.nome AS paciente
           FROM agendamento_cirurgico a
           JOIN paciente pa ON pa.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.situacao IN ('solicitado', 'em_analise', 'agendado', 'confirmado', 'no_bloco')
            AND (a.inicio_previsto_em IS NULL OR a.inicio_previsto_em >= CURDATE())
          ORDER BY a.inicio_previsto_em LIMIT 200`,
        [est.id],
      );
      return {
        setores: setores.map((r) => ({ id: num(r['id']), nome: String(r['nome']) })),
        unidades: unidades.map((r) => ({ id: num(r['id']), nome: String(r['nome']) })),
        agendamentos: ags.map((r) => ({
          id: num(r['id']),
          numero: String(r['numero']),
          paciente: String(r['paciente']),
          inicio: instante(r['inicio_previsto_em']),
        })),
        caixas: caixas.map((r) => ({
          id: num(r['id']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
          validadeDias: numOuNull(r['validade_esterilizacao_dias']),
          reprocessamentos: num(r['quantidade_reprocessamentos']),
          limite: numOuNull(r['limite_reprocessamentos']),
          pecas: num(r['pecas']),
        })),
        equipamentos: equipamentos.map((r) => ({
          id: num(r['id']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
          metodo: numOuNull(r['metodo_esterilizacao_id']),
        })),
        metodos: metodos.map((r) => ({
          id: num(r['id']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
        })),
        pacotes: pacotes.map(pacoteLido),
        ciclos: ciclos.map(cicloLido),
        solicitacoes: sols.map((s) => ({
          id: num(s['id']),
          numero: String(s['numero']),
          tipo: String(s['tipo']),
          situacao: String(s['situacao']),
          agendamento: numOuNull(s['agendamento_cirurgico_id']),
          itens: itens
            .filter((i) => num(i['sol']) === num(s['id']))
            .map((i) => ({
              id: num(i['id']),
              caixa: num(i['caixa_instrumental_id']),
              quantidade: num(i['quantidade']),
              situacao: String(i['situacao']),
              pacote: numOuNull(i['pacote_esteril_id']),
            })),
        })),
      };
    });
  }

  /** Produtos do estoque pelo nome ou código (3 letras), para as peças da caixa. */
  produtos(c: ContextoPortaPropria, busca: string): Promise<{ id: number; descricao: string }[]> {
    const termo = busca.trim();
    if (termo.length < 3) return Promise.resolve([]);
    return this.ler(c, 'produtos', async (l) =>
      (
        await l.consultar(
          `SELECT id, nome FROM insumo WHERE excluido_em IS NULL AND (nome LIKE ? OR codigo = ?) ORDER BY nome LIMIT 30`,
          [`%${termo}%`, termo],
        )
      ).map((r) => ({ id: num(r['id']), descricao: String(r['nome']) })),
    );
  }

  rastreio(c: ContextoPortaPropria, etiqueta: string): Promise<RastreioPacote> {
    return this.ler(c, 'rastreio', async (l, est) => {
      const p = await l.uma(`${SQL_PACOTES} AND p.codigo_etiqueta = ?`, [est.id, etiqueta.trim()]);
      if (!p) throw naoEncontrado('Pacote');
      return this.montarRastreio(l, est.id, p);
    });
  }

  /** Os pacotes entregues e usados numa cirurgia (visão por paciente). */
  pacotesDaCirurgia(c: ContextoPortaPropria, agendamento: number): Promise<RastreioPacote[]> {
    return this.ler(c, 'cirurgia', async (l, est) => {
      await this.agendamento(l, est.id, agendamento);
      const ps = await l.consultar(
        `${SQL_PACOTES} AND p.id IN (
            SELECT mi.pacote_esteril_id FROM movimento_material_esteril_item mi
              JOIN movimento_material_esteril m ON m.id = mi.movimento_material_esteril_id
             WHERE m.agendamento_cirurgico_id = ? AND m.situacao <> 'cancelado' AND mi.excluido_em IS NULL)
          ORDER BY p.id`,
        [est.id, agendamento],
      );
      const r: RastreioPacote[] = [];
      for (const p of ps) r.push(await this.montarRastreio(l, est.id, p));
      return r;
    });
  }

  private async montarRastreio(l: Fonte, est: number, p: Linha): Promise<RastreioPacote> {
    const ciclo = p['ciclo_esterilizacao_id']
      ? await l.uma(`${SQL_CICLOS} AND c.id = ?`, [est, p['ciclo_esterilizacao_id']])
      : null;
    const movs = await l.consultar(
      `SELECT m.id, m.agendamento_cirurgico_id, a.numero AS ag_numero, COALESCE(m.atendimento_id, a.atendimento_id)
              AS atendimento_id, a.paciente_id, pf.nome AS paciente_nome, m.ocorrido_em, m.situacao
         FROM movimento_material_esteril_item mi
         JOIN movimento_material_esteril m ON m.id = mi.movimento_material_esteril_id
         LEFT JOIN agendamento_cirurgico a ON a.id = m.agendamento_cirurgico_id
         LEFT JOIN paciente pa ON pa.id = a.paciente_id
         LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE mi.pacote_esteril_id = ? AND mi.excluido_em IS NULL AND m.tipo = 'entrega' AND m.situacao <> 'cancelado'
        ORDER BY m.ocorrido_em`,
      [p['id']],
    );
    const base = pacoteLido(p);
    const etiqueta = {
      codigo: base.etiqueta,
      produto: base.produto,
      lote: base.lote,
      esterilizadoEm: instante(p['esterilizado_em']),
      validade: base.validade,
      metodo: txtOuNull(p['metodo_nome']),
      preparadoPor: txtOuNull(p['preparado_por']),
    };
    return {
      pacote: { ...base, ...etiqueta, faltasEtiqueta: faltasDaEtiqueta(etiqueta) },
      ciclo: ciclo ? cicloLido(ciclo) : null,
      cirurgias: movs.map((m) => ({
        movimento: num(m['id']),
        agendamento: numOuNull(m['agendamento_cirurgico_id']),
        agendamentoNumero: txtOuNull(m['ag_numero']),
        atendimento: numOuNull(m['atendimento_id']),
        paciente: numOuNull(m['paciente_id']),
        pacienteNome: txtOuNull(m['paciente_nome']),
        entregueEm: instante(m['ocorrido_em']),
        usado: base.situacao === 'usado' && String(m['situacao']) === 'conferido',
      })),
    };
  }

  private async agendamento(l: Fonte, est: number, ag: number): Promise<Linha> {
    const a = await l.uma(
      'SELECT id, numero, atendimento_id, paciente_id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [ag, est],
    );
    if (!a) throw naoEncontrado('Agendamento cirúrgico');
    return a;
  }

  private async numero(tx: TxOperacao, est: number, tipo: string, prefixo: string) {
    const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      tipo,
      est,
    ]);
    if (!seq)
      await tx.incluir('sequencia_negocio', {
        estabelecimento_id: est,
        tipo,
        prefixo,
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return tx.proximoNumero(tipo);
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  criarCaixa(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaCaixa, entrada);
    recusa('Caixa de instrumental recusada', conferirCaixa(e));
    return this.gravar(
      c,
      'cirurgia.cme.caixa.criar',
      ['caixa_instrumental', 'caixa_instrumental_item'],
      async (tx, est) => {
        const dup = await tx.uma(
          'SELECT id FROM caixa_instrumental WHERE estabelecimento_id = ? AND codigo = ?',
          [est.id, e.codigo],
        );
        if (dup)
          throw recusaRegra('Caixa de instrumental recusada', [
            { campo: 'codigo', mensagem: 'Já há caixa com este código.' },
          ]);
        const caixa = await tx.incluir('caixa_instrumental', {
          estabelecimento_id: est.id,
          codigo: e.codigo,
          descricao: e.descricao,
          natureza: 'caixa',
          metodo_esterilizacao_id: e.metodo,
          validade_esterilizacao_dias: e.validadeDias,
          controla_reprocessamentos: e.controlaReprocessamentos,
          limite_reprocessamentos: e.limiteReprocessamentos,
          ativo: true,
        });
        let seq = 0;
        for (const i of e.itens)
          await tx.incluir('caixa_instrumental_item', {
            caixa_instrumental_id: caixa,
            sequencia: ++seq,
            insumo_id: i.insumo,
            produto_reprocessavel_id: i.produto,
            quantidade: i.quantidade,
            peca_mestre: i.pecaMestre,
          });
        return { tabela: 'caixa_instrumental', id: caixa, caixa };
      },
    );
  }

  criarEquipamento(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaEquipamento, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.equipamento.criar',
      ['equipamento_esterilizacao'],
      async (tx, est) => {
        const dup = await tx.uma(
          'SELECT id FROM equipamento_esterilizacao WHERE estabelecimento_id = ? AND codigo = ?',
          [est.id, e.codigo],
        );
        if (dup)
          throw recusaRegra('Equipamento recusado', [
            { campo: 'codigo', mensagem: 'Já há equipamento com este código.' },
          ]);
        const equipamento = await tx.incluir('equipamento_esterilizacao', {
          estabelecimento_id: est.id,
          codigo: e.codigo,
          descricao: e.descricao,
          natureza: e.natureza,
          metodo_esterilizacao_id: e.metodo,
          ativo: true,
        });
        return { tabela: 'equipamento_esterilizacao', id: equipamento, equipamento };
      },
    );
  }

  solicitar(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaSolicitacao, entrada);
    if (e.tipo === 'cirurgia' && !e.agendamento)
      throw recusaRegra('Solicitação recusada', [
        { campo: 'agendamento', mensagem: 'Escolha a cirurgia que vai usar o material.' },
      ]);
    return this.gravar(
      c,
      'cirurgia.cme.solicitacao.criar',
      ['solicitacao_material_esteril', 'solicitacao_material_esteril_item', 'sequencia_negocio'],
      async (tx, est, usuario) => {
        const ag = e.agendamento ? await this.agendamento(tx, est.id, e.agendamento) : null;
        const caixas = await tx.consultar(
          `SELECT id FROM caixa_instrumental WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
              AND id IN (${e.itens.map(() => '?').join(', ')})`,
          [est.id, ...e.itens.map((i) => i.caixa)],
        );
        const faltam = e.itens.filter((i) => !caixas.some((x) => num(x['id']) === i.caixa));
        recusa(
          'Solicitação recusada',
          faltam.map((i) => ({
            campo: 'itens',
            mensagem: `A caixa ${i.caixa} não está ativa neste estabelecimento.`,
          })),
        );
        const agora = new Date();
        const n = await this.numero(tx, est.id, 'solicitacao_material_esteril', 'SME-');
        const sol = await tx.incluir('solicitacao_material_esteril', {
          estabelecimento_id: est.id,
          numero: n.formatado,
          tipo: e.tipo,
          situacao: 'aberta',
          urgente: e.urgente,
          solicitante_unidade_assistencial_id: e.setor,
          agendamento_cirurgico_id: ag ? num(ag['id']) : null,
          atendimento_id: ag ? numOuNull(ag['atendimento_id']) : null,
          solicitado_em: agora,
          solicitante_usuario_id: usuario,
          necessario_ate: e.necessarioAte
            ? `${e.necessarioAte.slice(0, 10)} ${e.necessarioAte.slice(11, 16)}:00`
            : null,
        });
        let seq = 0;
        for (const i of e.itens)
          await tx.incluir('solicitacao_material_esteril_item', {
            solicitacao_material_esteril_id: sol,
            sequencia: ++seq,
            tipo_item: 'caixa',
            caixa_instrumental_id: i.caixa,
            quantidade: i.quantidade,
            situacao: 'pendente',
          });
        return { tabela: 'solicitacao_material_esteril', id: sol, solicitacao: sol, numero: n.formatado };
      },
    );
  }

  prepararPacote(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaPacote, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.pacote.preparar',
      [
        'pacote_esteril',
        'pacote_esteril_conteudo',
        'solicitacao_material_esteril',
        'solicitacao_material_esteril_item',
        'sequencia_negocio',
      ],
      async (tx, est, usuario) => {
        const cx =
          (
            await tx.consultarParaAtualizar<Linha>(
              `SELECT id, ativo, controla_reprocessamentos, limite_reprocessamentos, quantidade_reprocessamentos,
                  metodo_esterilizacao_id, tipo_embalagem_esteril_id
             FROM caixa_instrumental WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [e.caixa, est.id],
            )
          )[0] ?? null;
        if (!cx) throw naoEncontrado('Caixa de instrumental');
        recusa(
          'Pacote recusado',
          caixaReprocessavel({
            ativo: bool(cx['ativo']),
            controla: bool(cx['controla_reprocessamentos']),
            limite: numOuNull(cx['limite_reprocessamentos']),
            feitos: num(cx['quantidade_reprocessamentos']),
          }),
        );
        let item: Linha | null = null;
        if (e.solicitacaoItem) {
          item =
            (
              await tx.consultarParaAtualizar<Linha>(
                `SELECT i.id, i.versao, i.caixa_instrumental_id, i.situacao, i.solicitacao_material_esteril_id AS sol,
                    s.versao AS sol_versao, s.situacao AS sol_situacao
               FROM solicitacao_material_esteril_item i
               JOIN solicitacao_material_esteril s ON s.id = i.solicitacao_material_esteril_id
              WHERE i.id = ? AND s.estabelecimento_id = ? AND i.excluido_em IS NULL`,
                [e.solicitacaoItem, est.id],
              )
            )[0] ?? null;
          if (!item) throw naoEncontrado('Item da solicitação');
          if (num(item['caixa_instrumental_id']) !== e.caixa || String(item['situacao']) !== 'pendente')
            throw recusaRegra('Pacote recusado', [
              {
                campo: 'solicitacaoItem',
                mensagem: 'O item da solicitação é de outra caixa ou já está em processamento.',
              },
            ]);
        }
        const n = await this.numero(tx, est.id, 'pacote_esteril', '');
        const pacote = await tx.incluir('pacote_esteril', {
          estabelecimento_id: est.id,
          codigo_etiqueta: codigoEtiqueta(est.id, n.valor),
          caixa_instrumental_id: e.caixa,
          metodo_esterilizacao_id: numOuNull(cx['metodo_esterilizacao_id']),
          tipo_embalagem_esteril_id: e.embalagem ?? numOuNull(cx['tipo_embalagem_esteril_id']),
          preparado_em: new Date(),
          preparado_por_usuario_id: usuario,
          numero_reprocessamento: num(cx['quantidade_reprocessamentos']) + 1,
          situacao: 'aguardando_esterilizacao',
        });
        const pecas = await tx.consultar(
          `SELECT sequencia, insumo_id, produto_reprocessavel_id, quantidade, suspenso FROM caixa_instrumental_item
            WHERE caixa_instrumental_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [e.caixa],
        );
        for (const p of pecas)
          await tx.incluir('pacote_esteril_conteudo', {
            pacote_esteril_id: pacote,
            sequencia: num(p['sequencia']),
            insumo_id: numOuNull(p['insumo_id']),
            produto_reprocessavel_id: numOuNull(p['produto_reprocessavel_id']),
            quantidade_prevista: num(p['quantidade']),
            quantidade_presente: bool(p['suspenso']) ? 0 : num(p['quantidade']),
            situacao: bool(p['suspenso']) ? 'faltante' : 'completo',
          });
        if (item) {
          await tx.alterar('solicitacao_material_esteril_item', num(item['id']), num(item['versao']), {
            situacao: 'em_processamento',
            pacote_esteril_id: pacote,
          });
          if (['aberta', 'recebida_cme'].includes(String(item['sol_situacao'])))
            await tx.alterar('solicitacao_material_esteril', num(item['sol']), num(item['sol_versao']), {
              situacao: 'em_processamento',
              recebido_cme_em: new Date(),
              recebido_cme_usuario_id: usuario,
            });
        }
        return { tabela: 'pacote_esteril', id: pacote, pacote, etiqueta: codigoEtiqueta(est.id, n.valor) };
      },
    );
  }

  abrirCiclo(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaCiclo, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.ciclo.abrir',
      ['ciclo_esterilizacao', 'ciclo_esterilizacao_item', 'pacote_esteril', 'sequencia_negocio'],
      async (tx, est, usuario) => {
        const eq = await tx.uma(
          'SELECT id FROM equipamento_esterilizacao WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [e.equipamento, est.id],
        );
        if (!eq) throw naoEncontrado('Equipamento de esterilização');
        const met = await tx.uma('SELECT id FROM metodo_esterilizacao WHERE id = ? AND ativo = TRUE', [
          e.metodo,
        ]);
        if (!met) throw naoEncontrado('Método de esterilização');
        const pacotes = e.pacotes.length
          ? await tx.consultarParaAtualizar<Linha>(
              `SELECT p.id, p.situacao, p.metodo_esterilizacao_id, p.versao,
                      (c.situacao IN ('em_andamento', 'concluido')) AS em_carga
                 FROM pacote_esteril p LEFT JOIN ciclo_esterilizacao c ON c.id = p.ciclo_esterilizacao_id
                WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.id IN (${e.pacotes.map(() => '?').join(', ')})`,
              [est.id, ...e.pacotes],
            )
          : [];
        recusa(
          'Carga recusada',
          conferirCarga(
            e.metodo,
            pacotes.map((p) => ({
              id: num(p['id']),
              situacao: String(p['situacao']),
              metodo: numOuNull(p['metodo_esterilizacao_id']),
              emCarga: bool(p['em_carga']),
            })),
            e.pacotes,
          ),
        );
        const n = await this.numero(tx, est.id, 'ciclo_esterilizacao', 'CE-');
        const ciclo = await tx.incluir('ciclo_esterilizacao', {
          estabelecimento_id: est.id,
          numero: n.formatado,
          equipamento_esterilizacao_id: e.equipamento,
          metodo_esterilizacao_id: e.metodo,
          natureza: 'esterilizacao',
          numero_lote: `L${String(n.valor).padStart(6, '0')}`,
          inicio_em: new Date(),
          operador_usuario_id: usuario,
          situacao: 'em_andamento',
        });
        let seq = 0;
        for (const pid of e.pacotes) {
          const p = pacotes.find((x) => num(x['id']) === pid)!;
          await tx.incluir('ciclo_esterilizacao_item', {
            ciclo_esterilizacao_id: ciclo,
            sequencia: ++seq,
            pacote_esteril_id: pid,
          });
          await tx.alterar('pacote_esteril', pid, num(p['versao']), {
            ciclo_esterilizacao_id: ciclo,
            metodo_esterilizacao_id: e.metodo,
          });
        }
        return { tabela: 'ciclo_esterilizacao', id: ciclo, ciclo, numero: n.formatado };
      },
    );
  }

  concluirCiclo(c: ContextoPortaPropria, ciclo: number, entrada: unknown) {
    const e = entradaValida(esquemaConcluir, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.ciclo.concluir',
      [
        'ciclo_esterilizacao',
        'pacote_esteril',
        'caixa_instrumental',
        'solicitacao_material_esteril_item',
        'solicitacao_material_esteril',
      ],
      async (tx, est, usuario) => {
        const ci = await this.cicloTravado(tx, est.id, ciclo);
        if (String(ci['situacao']) !== 'em_andamento')
          throw recusaRegra('Ciclo recusado', [
            { campo: 'ciclo', mensagem: 'Só o ciclo em andamento é concluído.' },
          ]);
        const implante = await tx.uma(
          `SELECT COUNT(*) AS n FROM ciclo_esterilizacao_item i JOIN pacote_esteril p ON p.id = i.pacote_esteril_id
            WHERE i.ciclo_esterilizacao_id = ? AND i.excluido_em IS NULL AND p.material_terceiro_reprocessamento_id IS NOT NULL`,
          [ciclo],
        );
        const d = desfechoDoCiclo(e, num(implante?.['n']) > 0);
        if (d.situacao === 'recusa') throw recusaRegra('Ciclo recusado', d.problemas);
        const agora = new Date();
        await tx.alterar('ciclo_esterilizacao', ciclo, e.versao, {
          fim_em: agora,
          encerrado_por_usuario_id: usuario,
          temperatura_c: e.temperatura,
          pressao_kpa: e.pressao,
          tempo_exposicao_minutos: e.tempoExposicao,
          indicador_fisico: e.fisico === 'conforme',
          indicador_quimico: e.quimico === 'conforme',
          indicador_biologico: e.biologico === 'conforme',
          observacao: [e.observacao, d.motivo].filter(Boolean).join(' ').slice(0, 500),
          ...this.marcaDesfecho(d, agora, usuario),
        });
        await this.aplicarAosPacotes(tx, est, ciclo, d, agora);
        return { tabela: 'ciclo_esterilizacao', id: ciclo, situacao: d.situacao, motivo: d.motivo };
      },
    );
  }

  liberarCiclo(c: ContextoPortaPropria, ciclo: number, entrada: unknown) {
    const e = entradaValida(esquemaLiberar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.ciclo.liberar',
      [
        'ciclo_esterilizacao',
        'pacote_esteril',
        'caixa_instrumental',
        'solicitacao_material_esteril_item',
        'solicitacao_material_esteril',
      ],
      async (tx, est, usuario) => {
        const ci = await this.cicloTravado(tx, est.id, ciclo);
        const d = desfechoDaLiberacao(String(ci['situacao']), e.biologico);
        if (d.situacao === 'recusa') throw recusaRegra('Liberação recusada', d.problemas);
        const agora = new Date();
        await tx.alterar('ciclo_esterilizacao', ciclo, e.versao, {
          indicador_biologico: e.biologico === 'conforme',
          observacao: [txtOuNull(ci['observacao']), d.motivo].filter(Boolean).join(' ').slice(0, 500),
          ...this.marcaDesfecho(d, agora, usuario),
        });
        await this.aplicarAosPacotes(tx, est, ciclo, d, agora);
        return { tabela: 'ciclo_esterilizacao', id: ciclo, situacao: d.situacao, motivo: d.motivo };
      },
    );
  }

  private marcaDesfecho(d: DesfechoCiclo, agora: Date, usuario: number) {
    return d.situacao === 'liberado' || d.situacao === 'reprovado'
      ? { situacao: d.situacao, liberado_em: agora, liberado_por_usuario_id: usuario }
      : { situacao: d.situacao };
  }

  private async cicloTravado(tx: TxOperacao, est: number, ciclo: number): Promise<Linha> {
    const ci =
      (
        await tx.consultarParaAtualizar<Linha>(
          'SELECT id, situacao, versao, observacao FROM ciclo_esterilizacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [ciclo, est],
        )
      )[0] ?? null;
    if (!ci) throw naoEncontrado('Ciclo de esterilização');
    return ci;
  }

  /** Liberado: pacotes estéreis com validade; reprovado: pacotes rejeitados (voltam ao reprocessamento). */
  private async aplicarAosPacotes(
    tx: TxOperacao,
    est: { id: number; fuso: string },
    ciclo: number,
    d: DesfechoCiclo,
    agora: Date,
  ): Promise<void> {
    if (d.situacao !== 'liberado' && d.situacao !== 'reprovado') return;
    const ps = await tx.consultarParaAtualizar<Linha>(
      `SELECT p.id, p.versao, p.caixa_instrumental_id, cx.validade_esterilizacao_dias, te.validade_dias, cx.versao AS cx_versao,
              cx.quantidade_reprocessamentos
         FROM ciclo_esterilizacao_item i
         JOIN pacote_esteril p ON p.id = i.pacote_esteril_id
         LEFT JOIN caixa_instrumental cx ON cx.id = p.caixa_instrumental_id
         LEFT JOIN tipo_embalagem_esteril te ON te.id = p.tipo_embalagem_esteril_id
        WHERE i.ciclo_esterilizacao_id = ? AND i.excluido_em IS NULL AND p.situacao = 'aguardando_esterilizacao'`,
      [ciclo],
    );
    const hoje = hojeNo(est.fuso);
    for (const p of ps) {
      if (d.situacao === 'reprovado') {
        await tx.alterar('pacote_esteril', num(p['id']), num(p['versao']), { situacao: 'rejeitado' });
        continue;
      }
      const dias = diasDeValidade(numOuNull(p['validade_esterilizacao_dias']), numOuNull(p['validade_dias']));
      if (dias === null)
        throw recusaRegra('Liberação recusada', [
          {
            campo: 'pacotes',
            mensagem: 'Há pacote sem validade da esterilização (cadastre-a na caixa ou na embalagem).',
          },
        ]);
      await tx.alterar('pacote_esteril', num(p['id']), num(p['versao']), {
        situacao: 'esteril',
        esterilizado_em: agora,
        validade: validadeDoPacote(hoje, dias),
      });
      if (p['caixa_instrumental_id'])
        await tx.alterar('caixa_instrumental', num(p['caixa_instrumental_id']), num(p['cx_versao']), {
          quantidade_reprocessamentos: num(p['quantidade_reprocessamentos']) + 1,
        });
      const it = await tx.uma(
        "SELECT id, versao FROM solicitacao_material_esteril_item WHERE pacote_esteril_id = ? AND situacao = 'em_processamento' AND excluido_em IS NULL",
        [p['id']],
      );
      if (it)
        await tx.alterar('solicitacao_material_esteril_item', num(it['id']), num(it['versao']), {
          situacao: 'pronto',
          ciclo_esterilizacao_id: ciclo,
          validade_esterilizacao: validadeDoPacote(hoje, dias),
        });
    }
  }

  entregar(c: ContextoPortaPropria, pacote: number, entrada: unknown) {
    const e = entradaValida(esquemaEntregar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.pacote.entregar',
      [
        'movimento_material_esteril',
        'movimento_material_esteril_item',
        'pacote_esteril',
        'solicitacao_material_esteril_item',
        'solicitacao_material_esteril',
        'sequencia_negocio',
      ],
      async (tx, est, usuario) => {
        const p = await this.pacoteTravado(tx, est.id, pacote);
        const ag = await this.agendamento(tx, est.id, e.agendamento);
        recusa('Entrega recusada', conferirEntrega(this.paraUso(p, null), hojeNo(est.fuso)));
        const n = await this.numero(tx, est.id, 'movimento_material_esteril', '');
        const agora = new Date();
        const mov = await tx.incluir('movimento_material_esteril', {
          estabelecimento_id: est.id,
          numero: n.valor,
          tipo: 'entrega',
          cme_setor_funcional_id: e.cme,
          setor_funcional_id: e.setor,
          atendimento_id: numOuNull(ag['atendimento_id']),
          agendamento_cirurgico_id: e.agendamento,
          ocorrido_em: agora,
          responsavel_usuario_id: usuario,
          situacao: 'aberto',
        });
        await tx.incluir('movimento_material_esteril_item', {
          movimento_material_esteril_id: mov,
          sequencia: 1,
          pacote_esteril_id: pacote,
          caixa_instrumental_id: numOuNull(p['caixa_instrumental_id']),
          quantidade: 1,
          validade_esterilizacao: dia(p['validade']),
        });
        await tx.alterar('pacote_esteril', pacote, num(p['versao']), { situacao: 'distribuido' });
        const it = await tx.uma(
          `SELECT id, versao, solicitacao_material_esteril_id AS sol FROM solicitacao_material_esteril_item
            WHERE pacote_esteril_id = ? AND situacao IN ('em_processamento', 'pronto') AND excluido_em IS NULL`,
          [pacote],
        );
        if (it) {
          await tx.alterar('solicitacao_material_esteril_item', num(it['id']), num(it['versao']), {
            situacao: 'entregue',
            quantidade_atendida: 1,
          });
          const sol =
            (
              await tx.consultarParaAtualizar<Linha>(
                'SELECT id, versao FROM solicitacao_material_esteril WHERE id = ?',
                [it['sol']],
              )
            )[0] ?? null;
          const itens = await tx.consultar(
            'SELECT situacao FROM solicitacao_material_esteril_item WHERE solicitacao_material_esteril_id = ? AND excluido_em IS NULL',
            [it['sol']],
          );
          const nova = situacaoDaSolicitacao(itens.map((x) => ({ situacao: String(x['situacao']) })));
          await tx.alterar('solicitacao_material_esteril', num(sol!['id']), num(sol!['versao']), {
            situacao: nova,
            ...(nova === 'entregue' ? { entregue_em: agora, entregue_usuario_id: usuario } : {}),
          });
        }
        return { tabela: 'movimento_material_esteril', id: mov, movimento: mov };
      },
    );
  }

  usar(c: ContextoPortaPropria, pacote: number, entrada: unknown) {
    const e = entradaValida(esquemaUsar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.pacote.usar',
      ['pacote_esteril', 'movimento_material_esteril', 'movimento_material_esteril_item'],
      async (tx, est, usuario) => {
        const p = await this.pacoteTravado(tx, est.id, pacote);
        const mov =
          (
            await tx.consultarParaAtualizar<Linha>(
              `SELECT m.id, m.versao, m.agendamento_cirurgico_id, mi.id AS item, mi.versao AS item_versao
             FROM movimento_material_esteril_item mi
             JOIN movimento_material_esteril m ON m.id = mi.movimento_material_esteril_id
            WHERE mi.pacote_esteril_id = ? AND m.tipo = 'entrega' AND m.situacao = 'aberto' AND mi.excluido_em IS NULL
            ORDER BY m.ocorrido_em DESC LIMIT 1`,
              [pacote],
            )
          )[0] ?? null;
        recusa(
          'Uso recusado',
          conferirUso(
            this.paraUso(p, mov ? numOuNull(mov['agendamento_cirurgico_id']) : null),
            e.agendamento,
            hojeNo(est.fuso),
          ),
        );
        const agora = new Date();
        await tx.alterar('pacote_esteril', pacote, num(p['versao']), { situacao: 'usado' });
        await tx.alterar('movimento_material_esteril_item', num(mov!['item']), num(mov!['item_versao']), {
          conferido: true,
          conferido_em: agora,
        });
        await tx.alterar('movimento_material_esteril', num(mov!['id']), num(mov!['versao']), {
          situacao: 'conferido',
          conferido_em: agora,
          conferido_por_usuario_id: usuario,
        });
        return { tabela: 'pacote_esteril', id: pacote, pacote };
      },
    );
  }

  private async pacoteTravado(tx: TxOperacao, est: number, pacote: number): Promise<Linha> {
    const p =
      (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT p.id, p.versao, p.situacao, p.validade, p.caixa_instrumental_id, c.situacao AS ciclo_situacao
         FROM pacote_esteril p LEFT JOIN ciclo_esterilizacao c ON c.id = p.ciclo_esterilizacao_id
        WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
          [pacote, est],
        )
      )[0] ?? null;
    if (!p) throw naoEncontrado('Pacote');
    return p;
  }

  private paraUso(p: Linha, agendamento: number | null) {
    return {
      situacao: String(p['situacao']),
      validade: dia(p['validade']),
      cicloSituacao: txtOuNull(p['ciclo_situacao']),
      agendamentoEntregue: agendamento,
    };
  }
}
