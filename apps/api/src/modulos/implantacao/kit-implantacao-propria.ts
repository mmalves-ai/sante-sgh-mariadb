// Porta própria do kit de implantação (C2-025, 01-ADM L98) sobre o banco do cliente, pelo @sgh/nucleo:
//   - o checklist padrão (modelo_item_prontidao), editável pela plataforma: cadastros mínimos por módulo, conferidos por
//     contagem, e conferências, treinamentos e infraestrutura marcados à mão;
//   - o diagnóstico do hospital novo: o modelo com a contagem atual de cada cadastro, antes de abrir a implantação;
//   - a implantação do estabelecimento (implantacao_estabelecimento) com os itens (item_prontidao: prazo, responsável,
//     dispensa com motivo) e as metas (meta_implantacao: valor da meta e medição);
//   - a conferência: recontagem dos cadastros mínimos e a situação de cada item pelo domínio.
// As contagens são uma lista fechada no código (a `entidade` do modelo é só a chave dela): nada de SQL vindo do banco.
// Nada trava a virada (ADR 0002): o resumo é informativo. Nada é apagado: a implantação cancelada fica no histórico.
import {
  conferirDatasImplantacao,
  conferirMeta,
  conferirMudancaItem,
  FASES_IMPLANTACAO,
  INDICADORES_META,
  type IndicadorMeta,
  type ItemDoResumo,
  itemAtrasado,
  minimoEfetivo,
  type ProblemaImplantacao,
  resumoImplantacao,
  type ResumoImplantacao,
  SITUACOES_ITEM_PRONTIDAO,
  type SituacaoItemProntidao,
  type SituacaoMeta,
  situacaoMeta,
  situacaoPelaContagem,
  TIPOS_VERIFICACAO,
  type TipoVerificacao,
} from '@sgh/dominio-config';
import { ErroOperacao, type Escritor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  type EstabelecimentoDaSessao,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_KIT_IMPLANTACAO = Symbol('PORTA_KIT_IMPLANTACAO');

const TABELAS = [
  'modelo_item_prontidao',
  'implantacao_estabelecimento',
  'item_prontidao',
  'meta_implantacao',
];

/**
 * As contagens conhecidas do cadastro mínimo, pela chave gravada em `modelo_item_prontidao.entidade`. Todas recebem o
 * id do estabelecimento e contam só o que vale nele: usuários pelo acesso vigente ao estabelecimento
 * (`usuario_estabelecimento`), profissionais pela lotação vigente (`lotacao_profissional`) e exames pelo setor
 * executante do estabelecimento (`exame_setor_executante` + `setor_diagnostico`). Perfis e tabelas de preço da rede
 * (estabelecimento nulo) valem para todos.
 */
export const CONTAGENS_CADASTRO: Readonly<Record<string, string>> = {
  setor_funcional:
    'SELECT COUNT(*) AS n FROM setor_funcional WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
  usuario: `SELECT COUNT(DISTINCT u.id) AS n FROM usuario u
      JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id
     WHERE ue.estabelecimento_id = ? AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURRENT_DATE
       AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE) AND u.excluido_em IS NULL`,
  perfil_acesso:
    'SELECT COUNT(*) AS n FROM perfil_acesso WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo AND excluido_em IS NULL',
  profissional: `SELECT COUNT(DISTINCT p.id) AS n FROM profissional p
      JOIN lotacao_profissional l ON l.profissional_id = p.id
     WHERE l.estabelecimento_id = ? AND l.ativo AND l.excluido_em IS NULL AND l.vigencia_inicio <= CURRENT_DATE
       AND (l.vigencia_fim IS NULL OR l.vigencia_fim >= CURRENT_DATE)
       AND p.situacao = 'ativo' AND p.excluido_em IS NULL`,
  unidade_internacao:
    'SELECT COUNT(*) AS n FROM unidade_internacao WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
  leito_hospitalar:
    'SELECT COUNT(*) AS n FROM leito_hospitalar WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
  operadora_saude_estabelecimento:
    'SELECT COUNT(*) AS n FROM operadora_saude_estabelecimento WHERE estabelecimento_id = ? AND excluido_em IS NULL',
  tabela_preco:
    'SELECT COUNT(*) AS n FROM tabela_preco WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND excluido_em IS NULL',
  exame: `SELECT COUNT(DISTINCT e.id) AS n FROM exame e
      JOIN exame_setor_executante x ON x.exame_id = e.id
      JOIN setor_diagnostico s ON s.id = x.setor_diagnostico_id
     WHERE s.estabelecimento_id = ? AND s.ativo AND s.excluido_em IS NULL
       AND x.ativo AND x.excluido_em IS NULL AND e.ativo AND e.excluido_em IS NULL`,
  sala_cirurgica:
    'SELECT COUNT(*) AS n FROM sala_cirurgica WHERE estabelecimento_id = ? AND excluido_em IS NULL',
  local_estoque:
    'SELECT COUNT(*) AS n FROM local_estoque WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
  centro_custo:
    'SELECT COUNT(*) AS n FROM centro_custo WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
  conta_bancaria:
    'SELECT COUNT(*) AS n FROM conta_bancaria WHERE estabelecimento_id = ? AND excluido_em IS NULL',
};

export interface ItemModelo {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly descricao: string | null;
  readonly modulo: string;
  readonly tipo: TipoVerificacao;
  readonly entidade: string | null;
  readonly quantidadeMinima: number | null;
  readonly orientacao: string | null;
  readonly ordem: number;
  readonly critico: boolean;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface ItemDiagnostico extends ItemModelo {
  readonly contagem: number | null;
  readonly situacao: SituacaoItemProntidao;
}

export interface ItemImplantacao {
  readonly id: number;
  readonly sequencia: number;
  readonly modelo: ItemModelo;
  readonly situacao: SituacaoItemProntidao;
  readonly quantidadePrevista: number | null;
  readonly quantidadeRealizada: number | null;
  readonly dataInicioPrevista: string | null;
  readonly dataPrazo: string | null;
  readonly concluidoEm: string | null;
  readonly ultimaConferenciaEm: string | null;
  readonly responsavelNome: string | null;
  readonly responsavelEmail: string | null;
  readonly motivoDispensa: string | null;
  readonly observacao: string | null;
  readonly atrasado: boolean;
  readonly versao: number;
}

export interface MetaImplantacao {
  readonly id: number;
  readonly sequencia: number;
  readonly processo: string;
  readonly indicador: IndicadorMeta;
  readonly descricao: string | null;
  readonly unidade: string | null;
  readonly valorMeta: number;
  readonly valorMedido: number | null;
  readonly dataLimite: string | null;
  readonly medidoEm: string | null;
  readonly situacao: SituacaoMeta;
  readonly analise: string | null;
  readonly melhorias: string | null;
  readonly versao: number;
}

export interface ImplantacaoAberta {
  readonly id: number;
  readonly nome: string;
  readonly fase: string;
  readonly situacao: string;
  readonly dataInicioPrevista: string | null;
  readonly dataFimPrevista: string | null;
  readonly dataViradaPrevista: string | null;
  readonly viradaEm: string | null;
  readonly responsavelClienteNome: string | null;
  readonly responsavelClienteEmail: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

export interface PainelImplantacao {
  readonly hoje: string;
  readonly implantacao: ImplantacaoAberta | null;
  /** Sem implantação aberta: o diagnóstico pelo modelo (contagem atual de cada item). */
  readonly diagnostico: readonly ItemDiagnostico[];
  readonly itens: readonly ItemImplantacao[];
  readonly metas: readonly MetaImplantacao[];
  readonly resumo: ResumoImplantacao;
}

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
const textoOpc = (max: number) => z.string().trim().max(max).nullable().optional();

const esquemaModelo = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/),
    titulo: z.string().trim().min(3).max(200),
    descricao: textoOpc(2000),
    modulo: z.string().trim().min(2).max(30),
    tipo: z.enum(TIPOS_VERIFICACAO),
    entidade: z.string().trim().max(64).nullable().optional(),
    quantidadeMinima: z.number().int().min(1).max(100000).nullable().optional(),
    orientacao: textoOpc(2000),
    ordem: z.number().int().min(0).max(65000).optional(),
    critico: z.boolean().optional(),
    ativo: z.boolean().optional(),
  })
  .strict();

const esquemaIniciar = z
  .object({
    nome: z.string().trim().min(3).max(150),
    dataInicioPrevista: data,
    dataFimPrevista: data,
    dataViradaPrevista: data,
    responsavelClienteNome: textoOpc(150),
    responsavelClienteEmail: z.string().trim().email().max(254).nullable().optional(),
    observacao: textoOpc(4000),
  })
  .strict();

const esquemaAlterarImplantacao = esquemaIniciar
  .partial()
  .extend({
    fase: z.enum(FASES_IMPLANTACAO).optional(),
    situacao: z.enum(['planejada', 'em_andamento', 'suspensa', 'concluida', 'cancelada']).optional(),
    versao: z.number().int().min(1),
  })
  .strict();

const esquemaItem = z
  .object({
    situacao: z.enum(SITUACOES_ITEM_PRONTIDAO).optional(),
    motivoDispensa: textoOpc(500),
    dataInicioPrevista: data,
    dataPrazo: data,
    responsavelNome: textoOpc(150),
    responsavelEmail: z.string().trim().email().max(254).nullable().optional(),
    observacao: textoOpc(4000),
    versao: z.number().int().min(1),
  })
  .strict();

const esquemaMeta = z
  .object({
    processo: z.string().trim().max(150),
    indicador: z.enum(INDICADORES_META),
    valorMeta: z.number(),
    unidade: textoOpc(30),
    descricao: textoOpc(500),
    dataLimite: data,
    modulo: z.string().trim().max(30).nullable().optional(),
  })
  .strict();

const esquemaMedicao = z
  .object({
    valorMedido: z.number().min(0),
    analise: textoOpc(4000),
    melhorias: textoOpc(4000),
    versao: z.number().int().min(1),
  })
  .strict();

type Linha = Record<string, unknown>;

function recusar(titulo: string, p: readonly ProblemaImplantacao[]): void {
  if (p.length > 0) throw recusaRegra(titulo, p);
}

const conflito = (o: string) =>
  new ErroOperacao(
    409,
    'versao-desatualizada',
    `${o} alterado por outra pessoa`,
    'Recarregue e repita a alteração.',
  );

/** O dia civil no fuso do estabelecimento (AAAA-MM-DD). */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

const COLUNAS_MODELO = `m.id, m.codigo, m.titulo, m.descricao, ms.descricao AS modulo, m.tipo_verificacao, m.entidade,
  m.quantidade_minima, m.orientacao, m.ordem, m.critico, m.ativo, m.versao`;

function modeloLido(x: Linha): ItemModelo {
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    titulo: String(x['titulo']),
    descricao: txtOuNull(x['descricao']),
    modulo: String(x['modulo']),
    tipo: String(x['tipo_verificacao']) as TipoVerificacao,
    entidade: txtOuNull(x['entidade']),
    quantidadeMinima: numOuNull(x['quantidade_minima']),
    orientacao: txtOuNull(x['orientacao']),
    ordem: num(x['ordem']),
    critico: bool(x['critico']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

type Consulta = Pick<Leitor, 'uma'>;

/** Lê uma linha travada até o fim da transação (o núcleo acrescenta o FOR UPDATE). */
async function travada(tx: Escritor, sql: string, p: readonly unknown[]): Promise<Linha | null> {
  return (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
}

/** A contagem do cadastro do item; nula se não é de contagem ou se a chave não é conhecida. */
async function contar(l: Consulta, est: number, entidade: string | null): Promise<number | null> {
  const sql = entidade ? CONTAGENS_CADASTRO[entidade] : undefined;
  if (!sql) return null;
  const r = await l.uma(sql, [est]);
  return num(r?.['n']);
}

export class PortaKitImplantacaoPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    executor?: ConstructorParameters<typeof PortaEstabelecimentoPropria>[4],
  ) {
    super(nucleo, cliente, TABELAS, 'implantacao.kit', executor);
  }

  /** O checklist padrão, com os inativos (a plataforma edita). */
  modelo(c: ContextoPortaPropria): Promise<{ itens: ItemModelo[]; contagens: string[] }> {
    return this.ler(c, 'modelo', async (l) => ({
      itens: (
        await l.consultar(
          `SELECT ${COLUNAS_MODELO} FROM modelo_item_prontidao m JOIN modulo_sistema ms ON ms.id = m.modulo_sistema_id
            ORDER BY m.ordem, m.id`,
        )
      ).map(modeloLido),
      contagens: Object.keys(CONTAGENS_CADASTRO).sort(),
    }));
  }

  /** Inclui ou altera (pelo código) um item do checklist padrão. */
  async salvarModelo(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaModelo, entrada);
    if (e.tipo === 'cadastro_minimo' && !(e.entidade && CONTAGENS_CADASTRO[e.entidade]))
      throw recusaRegra('Item recusado', [
        {
          campo: 'entidade',
          mensagem: `O cadastro mínimo é conferido por contagem: escolha uma das contagens conhecidas (${Object.keys(CONTAGENS_CADASTRO).join(', ')}).`,
        },
      ]);
    return this.gravar(
      c,
      'implantacao.kit.salvar-modelo',
      ['modelo_item_prontidao'],
      async (tx, _est, usuario) => {
        const m = await tx.uma('SELECT id FROM modulo_sistema WHERE codigo = ? AND ativo', [e.modulo]);
        if (!m)
          throw recusaRegra('Item recusado', [
            { campo: 'modulo', mensagem: 'Módulo do sistema não encontrado.' },
          ]);
        const entidade = e.tipo === 'cadastro_minimo' ? (e.entidade ?? null) : null;
        const minima = e.tipo === 'cadastro_minimo' ? (e.quantidadeMinima ?? 1) : null;
        const atual = await travada(tx, 'SELECT id FROM modelo_item_prontidao WHERE codigo = ?', [e.codigo]);
        if (atual) {
          await tx.executar(
            `UPDATE modelo_item_prontidao SET titulo = ?, descricao = ?, modulo_sistema_id = ?, tipo_verificacao = ?,
                  entidade = ?, quantidade_minima = ?, orientacao = ?, ordem = ?, critico = ?, ativo = ?,
                  alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
            WHERE id = ?`,
            [
              e.titulo,
              e.descricao ?? null,
              num(m['id']),
              e.tipo,
              entidade,
              minima,
              e.orientacao ?? null,
              e.ordem ?? 500,
              e.critico ?? false,
              e.ativo ?? true,
              usuario,
              num(atual['id']),
            ],
          );
          return { tabela: 'modelo_item_prontidao', id: num(atual['id']) };
        }
        const id = await tx.inserir(
          `INSERT INTO modelo_item_prontidao (codigo, titulo, descricao, modulo_sistema_id, tipo_verificacao, entidade,
                quantidade_minima, orientacao, ordem, critico, ativo, criado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)`,
          [
            e.codigo,
            e.titulo,
            e.descricao ?? null,
            num(m['id']),
            e.tipo,
            entidade,
            minima,
            e.orientacao ?? null,
            e.ordem ?? 500,
            e.critico ?? false,
            e.ativo ?? true,
            usuario,
          ],
        );
        return { tabela: 'modelo_item_prontidao', id };
      },
    );
  }

  /** O painel do "o que falta": a implantação aberta (itens, metas e resumo) ou o diagnóstico pelo modelo. */
  painel(c: ContextoPortaPropria): Promise<PainelImplantacao> {
    return this.ler(c, 'painel', async (l, est) => {
      const hoje = hojeNoFuso(est.fuso);
      const imp = await this.implantacaoAberta(l, est);
      if (!imp) {
        const diagnostico: ItemDiagnostico[] = [];
        const modelo = (
          await l.consultar(
            `SELECT ${COLUNAS_MODELO} FROM modelo_item_prontidao m JOIN modulo_sistema ms ON ms.id = m.modulo_sistema_id
              WHERE m.ativo ORDER BY m.ordem, m.id`,
          )
        ).map(modeloLido);
        for (const m of modelo) {
          const contagem = m.tipo === 'cadastro_minimo' ? await contar(l, est.id, m.entidade) : null;
          const situacao = situacaoPelaContagem({ ...m, contagem, atual: 'pendente' });
          diagnostico.push({ ...m, contagem, situacao });
        }
        const resumo = resumoImplantacao(
          diagnostico.map((d) => ({ ...d, dataPrazo: null })),
          hoje,
        );
        return { hoje, implantacao: null, diagnostico, itens: [], metas: [], resumo };
      }
      const itens = await this.itensDa(l, imp.id, hoje);
      const metas = (
        await l.consultar(
          `SELECT id, sequencia, processo, indicador, descricao, unidade, valor_meta, valor_medido,
                  DATE_FORMAT(data_limite, '%Y-%m-%d') AS data_limite, medido_em, situacao, analise, melhorias, versao
             FROM meta_implantacao WHERE implantacao_estabelecimento_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [imp.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        sequencia: num(x['sequencia']),
        processo: String(x['processo']),
        indicador: String(x['indicador']) as IndicadorMeta,
        descricao: txtOuNull(x['descricao']),
        unidade: txtOuNull(x['unidade']),
        valorMeta: num(x['valor_meta']),
        valorMedido: numOuNull(x['valor_medido']),
        dataLimite: txtOuNull(x['data_limite']),
        medidoEm: x['medido_em'] ? new Date(String(x['medido_em'])).toISOString() : null,
        situacao: String(x['situacao']) as SituacaoMeta,
        analise: txtOuNull(x['analise']),
        melhorias: txtOuNull(x['melhorias']),
        versao: num(x['versao']),
      }));
      const resumo = resumoImplantacao(itens.map(paraResumo), hoje);
      return { hoje, implantacao: imp, diagnostico: [], itens, metas, resumo };
    });
  }

  /** Abre a implantação do estabelecimento com um item por linha ativa do modelo, já conferida pela contagem. */
  async iniciar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; itens: number }> {
    const e = entradaValida(esquemaIniciar, entrada);
    recusar('Implantação recusada', conferirDatasImplantacao(e));
    return this.gravar(
      c,
      'implantacao.kit.iniciar',
      ['implantacao_estabelecimento', 'item_prontidao'],
      async (tx, est, usuario) => {
        const aberta = await travada(
          tx,
          `SELECT id FROM implantacao_estabelecimento WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN ('planejada','em_andamento','suspensa')`,
          [est.id],
        );
        if (aberta)
          throw recusaRegra('Implantação recusada', [
            {
              campo: 'nome',
              mensagem: 'O estabelecimento já tem uma implantação aberta: conclua ou cancele antes.',
            },
          ]);
        const id = await tx.inserir(
          `INSERT INTO implantacao_estabelecimento (estabelecimento_id, nome, fase, situacao, data_inicio_prevista,
                  data_fim_prevista, data_virada_prevista, data_inicio_real, responsavel_usuario_id,
                  responsavel_cliente_nome, responsavel_cliente_email, observacao, criado_em, criado_por)
           VALUES (?, ?, 'inicializacao', 'em_andamento', ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)`,
          [
            est.id,
            e.nome,
            e.dataInicioPrevista ?? null,
            e.dataFimPrevista ?? null,
            e.dataViradaPrevista ?? null,
            hojeNoFuso(est.fuso),
            usuario,
            e.responsavelClienteNome ?? null,
            e.responsavelClienteEmail ?? null,
            e.observacao ?? null,
            usuario,
          ],
        );
        const modelo = (
          await tx.consultar(
            `SELECT ${COLUNAS_MODELO} FROM modelo_item_prontidao m JOIN modulo_sistema ms ON ms.id = m.modulo_sistema_id
              WHERE m.ativo ORDER BY m.ordem, m.id`,
          )
        ).map(modeloLido);
        let seq = 0;
        for (const m of modelo) {
          seq += 1;
          const contagem = m.tipo === 'cadastro_minimo' ? await contar(tx, est.id, m.entidade) : null;
          const situacao = situacaoPelaContagem({ ...m, contagem, atual: 'pendente' });
          await tx.inserir(
            `INSERT INTO item_prontidao (implantacao_estabelecimento_id, sequencia, modelo_item_prontidao_id, situacao,
                    quantidade_prevista, quantidade_realizada, data_inicio_prevista, concluido_em,
                    ultima_conferencia_em, criado_em, criado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)`,
            [
              id,
              seq,
              m.id,
              situacao,
              m.tipo === 'cadastro_minimo' ? minimoEfetivo(m.quantidadeMinima) : null,
              contagem,
              e.dataInicioPrevista ?? null,
              situacao === 'pronto' ? new Date() : null,
              contagem === null ? null : new Date(),
              usuario,
            ],
          );
        }
        return { tabela: 'implantacao_estabelecimento', id, itens: seq };
      },
    );
  }

  /** Reconta os cadastros mínimos e atualiza a situação dos itens que mudaram. */
  conferir(c: ContextoPortaPropria, implantacao: number): Promise<{ alterados: number; conferidos: number }> {
    return this.gravar(c, 'implantacao.kit.conferir', ['item_prontidao'], async (tx, est, usuario) => {
      await this.implantacaoDoEstabelecimento(tx, est, implantacao);
      const itens = await tx.consultarParaAtualizar(
        `SELECT i.id, i.situacao, i.quantidade_realizada, m.tipo_verificacao, m.entidade, m.quantidade_minima
           FROM item_prontidao i JOIN modelo_item_prontidao m ON m.id = i.modelo_item_prontidao_id
          WHERE i.implantacao_estabelecimento_id = ? AND i.excluido_em IS NULL AND m.tipo_verificacao = 'cadastro_minimo'`,
        [implantacao],
      );
      let alterados = 0;
      for (const i of itens) {
        const contagem = await contar(tx, est.id, txtOuNull(i['entidade']));
        const atual = String(i['situacao']) as SituacaoItemProntidao;
        const nova = situacaoPelaContagem({
          tipo: 'cadastro_minimo',
          quantidadeMinima: numOuNull(i['quantidade_minima']),
          contagem,
          atual,
        });
        const mudou = nova !== atual || contagem !== numOuNull(i['quantidade_realizada']);
        if (mudou) alterados += 1;
        await tx.executar(
          `UPDATE item_prontidao SET quantidade_realizada = ?, situacao = ?, ultima_conferencia_em = NOW(3),
                  concluido_em = CASE WHEN ? = 'pronto' THEN COALESCE(concluido_em, NOW(3)) ELSE NULL END
                  ${mudou ? ', alterado_em = NOW(3), alterado_por = ?, versao = versao + 1' : ''}
            WHERE id = ?`,
          mudou ? [contagem, nova, nova, usuario, num(i['id'])] : [contagem, nova, nova, num(i['id'])],
        );
      }
      return { tabela: 'implantacao_estabelecimento', id: implantacao, alterados, conferidos: itens.length };
    });
  }

  /** Prazo, responsável, observação e situação manual de um item (dispensa com motivo; reabrir a dispensa). */
  async alterarItem(
    c: ContextoPortaPropria,
    item: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string }> {
    const e = entradaValida(esquemaItem, entrada);
    return this.gravar(c, 'implantacao.kit.alterar-item', ['item_prontidao'], async (tx, est, usuario) => {
      const i = await travada(
        tx,
        `SELECT i.id, i.versao, i.situacao, i.quantidade_realizada, DATE_FORMAT(i.data_inicio_prevista, '%Y-%m-%d') AS ini,
                i.motivo_dispensa, i.implantacao_estabelecimento_id, m.tipo_verificacao, m.entidade, m.quantidade_minima
           FROM item_prontidao i JOIN modelo_item_prontidao m ON m.id = i.modelo_item_prontidao_id
           JOIN implantacao_estabelecimento ie ON ie.id = i.implantacao_estabelecimento_id
          WHERE i.id = ? AND ie.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [item, est.id],
      );
      if (!i) throw naoEncontrado('Item da implantação');
      if (num(i['versao']) !== e.versao) throw conflito('Item');
      const tipo = String(i['tipo_verificacao']) as TipoVerificacao;
      const contagem = tipo === 'cadastro_minimo' ? await contar(tx, est.id, txtOuNull(i['entidade'])) : null;
      const inicio = e.dataInicioPrevista !== undefined ? e.dataInicioPrevista : txtOuNull(i['ini']);
      recusar(
        'Item recusado',
        conferirMudancaItem(
          {
            tipo,
            quantidadeMinima: numOuNull(i['quantidade_minima']),
            contagem,
            situacao: String(i['situacao']) as SituacaoItemProntidao,
            dataInicioPrevista: inicio,
          },
          e,
        ),
      );
      let situacao = (e.situacao ?? String(i['situacao'])) as SituacaoItemProntidao;
      // Reaberto da dispensa, o cadastro mínimo volta à situação da contagem.
      if (situacao !== 'dispensado' && tipo === 'cadastro_minimo')
        situacao = situacaoPelaContagem({
          tipo,
          quantidadeMinima: numOuNull(i['quantidade_minima']),
          contagem,
          atual: situacao === 'pronto' ? 'pendente' : situacao,
        });
      const motivo = situacao === 'dispensado' ? (e.motivoDispensa ?? txtOuNull(i['motivo_dispensa'])) : null;
      const sets: string[] = ['situacao = ?', 'motivo_dispensa = ?'];
      const vals: unknown[] = [situacao, motivo];
      sets.push("concluido_em = CASE WHEN ? = 'pronto' THEN COALESCE(concluido_em, NOW(3)) ELSE NULL END");
      vals.push(situacao);
      if (contagem !== null) {
        sets.push('quantidade_realizada = ?', 'ultima_conferencia_em = NOW(3)');
        vals.push(contagem);
      }
      const campos: [keyof typeof e, string][] = [
        ['dataInicioPrevista', 'data_inicio_prevista'],
        ['dataPrazo', 'data_prazo'],
        ['responsavelNome', 'responsavel_cliente_nome'],
        ['responsavelEmail', 'responsavel_cliente_email'],
        ['observacao', 'observacao'],
      ];
      for (const [k, col] of campos)
        if (e[k] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(e[k]);
        }
      const lista = sets.join(', ');
      await tx.executar(
        `UPDATE item_prontidao SET ${lista}, alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
          WHERE id = ?`,
        [...vals, usuario, item],
      );
      return { tabela: 'item_prontidao', id: item, situacao };
    });
  }

  /** Fase, situação, datas e responsáveis do projeto; a fase "virada" registra o momento (informativo, sem trava). */
  async alterarImplantacao(
    c: ContextoPortaPropria,
    implantacao: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaAlterarImplantacao, entrada);
    return this.gravar(
      c,
      'implantacao.kit.alterar-implantacao',
      ['implantacao_estabelecimento'],
      async (tx, est, usuario) => {
        const atual = await this.implantacaoDoEstabelecimento(tx, est, implantacao);
        if (num(atual['versao']) !== e.versao) throw conflito('Implantação');
        recusar(
          'Implantação recusada',
          conferirDatasImplantacao({
            dataInicioPrevista:
              e.dataInicioPrevista !== undefined ? e.dataInicioPrevista : txtOuNull(atual['ini']),
            dataFimPrevista: e.dataFimPrevista !== undefined ? e.dataFimPrevista : txtOuNull(atual['fim']),
            dataViradaPrevista:
              e.dataViradaPrevista !== undefined ? e.dataViradaPrevista : txtOuNull(atual['virada']),
          }),
        );
        const sets: string[] = [];
        const vals: unknown[] = [];
        const campos: [keyof typeof e, string][] = [
          ['nome', 'nome'],
          ['fase', 'fase'],
          ['situacao', 'situacao'],
          ['dataInicioPrevista', 'data_inicio_prevista'],
          ['dataFimPrevista', 'data_fim_prevista'],
          ['dataViradaPrevista', 'data_virada_prevista'],
          ['responsavelClienteNome', 'responsavel_cliente_nome'],
          ['responsavelClienteEmail', 'responsavel_cliente_email'],
          ['observacao', 'observacao'],
        ];
        for (const [k, col] of campos)
          if (e[k] !== undefined) {
            sets.push(`${col} = ?`);
            vals.push(e[k]);
          }
        if (e.fase === 'virada') sets.push('virada_em = COALESCE(virada_em, NOW(3))');
        if (e.situacao === 'concluida') {
          sets.push('data_fim_real = COALESCE(data_fim_real, ?)');
          vals.push(hojeNoFuso(est.fuso));
        }
        const lista = [...sets, 'alterado_em = NOW(3)', 'alterado_por = ?', 'versao = versao + 1'].join(', ');
        await tx.executar(`UPDATE implantacao_estabelecimento SET ${lista} WHERE id = ?`, [
          ...vals,
          usuario,
          implantacao,
        ]);
        return { tabela: 'implantacao_estabelecimento', id: implantacao };
      },
    );
  }

  /** Inclui uma meta da implantação (processo, indicador e valor). */
  async incluirMeta(c: ContextoPortaPropria, implantacao: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMeta, entrada);
    recusar('Meta recusada', conferirMeta(e));
    return this.gravar(c, 'implantacao.kit.incluir-meta', ['meta_implantacao'], async (tx, est, usuario) => {
      await this.implantacaoDoEstabelecimento(tx, est, implantacao);
      const mod = e.modulo
        ? await tx.uma('SELECT id FROM modulo_sistema WHERE codigo = ?', [e.modulo])
        : null;
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM meta_implantacao WHERE implantacao_estabelecimento_id = ?',
        [implantacao],
      );
      const id = await tx.inserir(
        `INSERT INTO meta_implantacao (implantacao_estabelecimento_id, sequencia, modulo_sistema_id, processo, indicador,
                descricao, unidade, valor_meta, data_limite, situacao, criado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', NOW(3), ?)`,
        [
          implantacao,
          num(seq?.['s']),
          mod ? num(mod['id']) : null,
          e.processo,
          e.indicador,
          e.descricao ?? null,
          e.unidade ?? null,
          e.valorMeta,
          e.dataLimite ?? null,
          usuario,
        ],
      );
      return { tabela: 'meta_implantacao', id };
    });
  }

  /** Registra a medição da meta; a situação sai do domínio (atingida, parcial, não atingida). */
  async medirMeta(
    c: ContextoPortaPropria,
    meta: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoMeta }> {
    const e = entradaValida(esquemaMedicao, entrada);
    return this.gravar(c, 'implantacao.kit.medir-meta', ['meta_implantacao'], async (tx, est, usuario) => {
      const m = await travada(
        tx,
        `SELECT mi.versao, mi.indicador, mi.valor_meta, mi.situacao, DATE_FORMAT(mi.data_limite, '%Y-%m-%d') AS limite
           FROM meta_implantacao mi JOIN implantacao_estabelecimento ie ON ie.id = mi.implantacao_estabelecimento_id
          WHERE mi.id = ? AND ie.estabelecimento_id = ? AND mi.excluido_em IS NULL`,
        [meta, est.id],
      );
      if (!m) throw naoEncontrado('Meta da implantação');
      if (num(m['versao']) !== e.versao) throw conflito('Meta');
      const situacao = situacaoMeta({
        indicador: String(m['indicador']) as IndicadorMeta,
        valorMeta: num(m['valor_meta']),
        valorMedido: e.valorMedido,
        dataLimite: txtOuNull(m['limite']),
        atual: String(m['situacao']) as SituacaoMeta,
        hoje: hojeNoFuso(est.fuso),
      });
      await tx.executar(
        `UPDATE meta_implantacao SET valor_medido = ?, medido_em = NOW(3), situacao = ?, analise = COALESCE(?, analise),
                melhorias = COALESCE(?, melhorias), alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
          WHERE id = ?`,
        [e.valorMedido, situacao, e.analise ?? null, e.melhorias ?? null, usuario, meta],
      );
      return { tabela: 'meta_implantacao', id: meta, situacao };
    });
  }

  private async implantacaoAberta(
    l: Leitor,
    est: EstabelecimentoDaSessao,
  ): Promise<ImplantacaoAberta | null> {
    const x = await l.uma(
      `SELECT id, nome, fase, situacao, DATE_FORMAT(data_inicio_prevista, '%Y-%m-%d') AS ini,
              DATE_FORMAT(data_fim_prevista, '%Y-%m-%d') AS fim, DATE_FORMAT(data_virada_prevista, '%Y-%m-%d') AS virada,
              virada_em, responsavel_cliente_nome, responsavel_cliente_email, observacao, versao
         FROM implantacao_estabelecimento WHERE estabelecimento_id = ? AND excluido_em IS NULL
          AND situacao IN ('planejada','em_andamento','suspensa','concluida')
        ORDER BY FIELD(situacao,'em_andamento','planejada','suspensa','concluida'), id DESC LIMIT 1`,
      [est.id],
    );
    if (!x) return null;
    return {
      id: num(x['id']),
      nome: String(x['nome']),
      fase: String(x['fase']),
      situacao: String(x['situacao']),
      dataInicioPrevista: txtOuNull(x['ini']),
      dataFimPrevista: txtOuNull(x['fim']),
      dataViradaPrevista: txtOuNull(x['virada']),
      viradaEm: x['virada_em'] ? new Date(String(x['virada_em'])).toISOString() : null,
      responsavelClienteNome: txtOuNull(x['responsavel_cliente_nome']),
      responsavelClienteEmail: txtOuNull(x['responsavel_cliente_email']),
      observacao: txtOuNull(x['observacao']),
      versao: num(x['versao']),
    };
  }

  private async itensDa(l: Leitor, implantacao: number, hoje: string): Promise<ItemImplantacao[]> {
    return (
      await l.consultar(
        `SELECT ${COLUNAS_MODELO}, i.id AS item_id, i.sequencia, i.situacao, i.quantidade_prevista,
                i.quantidade_realizada, DATE_FORMAT(i.data_inicio_prevista, '%Y-%m-%d') AS ini,
                DATE_FORMAT(i.data_prazo, '%Y-%m-%d') AS prazo, i.concluido_em, i.ultima_conferencia_em,
                i.responsavel_cliente_nome, i.responsavel_cliente_email, i.motivo_dispensa, i.observacao,
                i.versao AS item_versao
           FROM item_prontidao i JOIN modelo_item_prontidao m ON m.id = i.modelo_item_prontidao_id
           JOIN modulo_sistema ms ON ms.id = m.modulo_sistema_id
          WHERE i.implantacao_estabelecimento_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [implantacao],
      )
    ).map((x) => {
      const situacao = String(x['situacao']) as SituacaoItemProntidao;
      const dataPrazo = txtOuNull(x['prazo']);
      const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
      return {
        id: num(x['item_id']),
        sequencia: num(x['sequencia']),
        modelo: modeloLido(x),
        situacao,
        quantidadePrevista: numOuNull(x['quantidade_prevista']),
        quantidadeRealizada: numOuNull(x['quantidade_realizada']),
        dataInicioPrevista: txtOuNull(x['ini']),
        dataPrazo,
        concluidoEm: iso(x['concluido_em']),
        ultimaConferenciaEm: iso(x['ultima_conferencia_em']),
        responsavelNome: txtOuNull(x['responsavel_cliente_nome']),
        responsavelEmail: txtOuNull(x['responsavel_cliente_email']),
        motivoDispensa: txtOuNull(x['motivo_dispensa']),
        observacao: txtOuNull(x['observacao']),
        atrasado: itemAtrasado({ situacao, dataPrazo }, hoje),
        versao: num(x['item_versao']),
      };
    });
  }

  private async implantacaoDoEstabelecimento(
    l: Consulta,
    est: EstabelecimentoDaSessao,
    id: number,
  ): Promise<Linha> {
    const x = await l.uma(
      `SELECT id, versao, DATE_FORMAT(data_inicio_prevista, '%Y-%m-%d') AS ini,
              DATE_FORMAT(data_fim_prevista, '%Y-%m-%d') AS fim, DATE_FORMAT(data_virada_prevista, '%Y-%m-%d') AS virada
         FROM implantacao_estabelecimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est.id],
    );
    if (!x) throw naoEncontrado('Implantação');
    return x;
  }
}

function paraResumo(i: ItemImplantacao): ItemDoResumo {
  return {
    id: i.id,
    modulo: i.modelo.modulo,
    titulo: i.modelo.titulo,
    tipo: i.modelo.tipo,
    situacao: i.situacao,
    critico: i.modelo.critico,
    ordem: i.sequencia,
    dataPrazo: i.dataPrazo,
  };
}
