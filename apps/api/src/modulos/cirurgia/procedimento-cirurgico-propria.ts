// Cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91), no banco do cliente (`procedimento_cirurgico`).
// Contrato de efeito:
//   - incluir: uma linha com o código normalizado (maiúsculas), descrição, abreviação, grupo, porte, especialidade,
//     natureza, caráter e anestesia sugeridos, duração média, preparo da sala e as exigências do agendamento, em uso e
//     com origem 'sistema'; código repetido é recusado (409) antes do banco; a regra do domínio
//     (validarProcedimentoCirurgico) recusa com 422 sem escrita;
//   - alterar: a mesma linha com a versão lida (+1); a anterior fica na trilha;
//   - tirar de uso / voltar ao uso: `ativo` com a versão; nada é apagado (agendamentos, atos e textos padrão apontam
//     para o procedimento);
//   - ligação com o faturamento: o item cobrado (item_faturavel, TUSS ou tabela própria, do tipo procedimento ou
//     pacote) e o procedimento SUS (procedimento_sigtap, vigente) gravados no procedimento, como o código que a guia
//     TISS e a AIH levam; também a via de acesso (TISS) e a classe de contaminação esperada (controle de infecção);
//   - sugestões ao agendamento: buscarProcedimentosComSugestao devolve à busca do mapa cirúrgico o caráter, a
//     anestesia e a duração (média ou a de referência do porte), aplicados pela regra aplicarSugestoesDoProcedimento;
//   - cadastros ligados: grupo, porte, especialidade, caráter, anestesia, via, classe, item cobrado e SUS precisam existir; um que está fora de uso só
//     é aceito se já era o valor gravado (o cadastro antigo não trava a alteração de outro campo);
//   - escopo: o procedimento é do cliente (vale em todos os estabelecimentos), como o texto padrão que se liga a ele.
import {
  duracaoSugeridaProcedimento,
  normalizarCodigoProcedimento,
  validarProcedimentoCirurgico,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_PROCEDIMENTO_CIRURGICO = Symbol('PORTA_PROCEDIMENTO_CIRURGICO');

const TABELA = 'procedimento_cirurgico';
type Linha = Record<string, unknown>;

export interface ProcedimentoCirurgicoLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly mnemonico: string | null;
  readonly natureza: string;
  readonly grupo: number | null;
  readonly grupoDescricao: string | null;
  readonly porte: number | null;
  readonly porteDescricao: string | null;
  readonly especialidade: number | null;
  readonly especialidadeDescricao: string | null;
  readonly carater: number | null;
  readonly caraterDescricao: string | null;
  readonly tipoAnestesia: number | null;
  readonly viaAcesso: number | null;
  readonly classeContaminacao: number | null;
  /** O item cobrado (TUSS ou tabela própria) e o procedimento SUS, com código e descrição para a tela. */
  readonly itemFaturavel: number | null;
  readonly itemFaturavelCodigo: string | null;
  readonly itemFaturavelDescricao: string | null;
  readonly procedimentoSigtap: number | null;
  readonly sigtapCodigo: string | null;
  readonly sigtapDescricao: string | null;
  readonly duracaoMediaMinutos: number | null;
  readonly tempoPreparoSalaMinutos: number | null;
  readonly exigeLateralidade: boolean;
  readonly obstetrico: boolean;
  readonly hemodinamica: boolean;
  readonly exigeExameImagem: boolean;
  readonly exigePlano: boolean;
  readonly orientacaoPaciente: string | null;
  readonly preparo: string | null;
  readonly ativo: boolean;
  readonly origem: string;
  /** Textos padrão da descrição em uso ligados ao procedimento (o atalho da tela leva ao cadastro deles). */
  readonly textosPadrao: number;
  readonly versao: number;
}

export interface OpcaoCadastro {
  readonly id: number;
  readonly descricao: string;
}

export interface ApoioProcedimentoCirurgico {
  readonly grupos: OpcaoCadastro[];
  readonly portes: (OpcaoCadastro & { readonly duracaoReferenciaMinutos: number | null })[];
  readonly especialidades: OpcaoCadastro[];
  readonly carateres: OpcaoCadastro[];
  readonly anestesias: OpcaoCadastro[];
  readonly vias: OpcaoCadastro[];
  readonly classesContaminacao: OpcaoCadastro[];
}

/** Um item de catálogo encontrado na busca (item cobrado ou procedimento SUS). */
export interface ItemDeCatalogo {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
}

/** Um procedimento da busca do agendamento, com o que o cadastro sugere (aplicarSugestoesDoProcedimento). */
export interface ProcedimentoComSugestao {
  readonly codigo: number;
  readonly nome: string;
  readonly carater: number | null;
  readonly anestesia: number | null;
  readonly duracaoMin: number | null;
}

const id = z.number().int().positive();
const minutos = z.number().int().min(0).max(1440).nullable().optional();
const esquema = z
  .object({
    codigo: z.string().max(60),
    descricao: z.string().max(300),
    mnemonico: z.string().max(30).nullable().optional(),
    natureza: z.string().max(30),
    grupo: id.nullable(),
    porte: id.nullable(),
    especialidade: id.nullable(),
    carater: id.nullable().optional(),
    tipoAnestesia: id.nullable().optional(),
    viaAcesso: id.nullable().optional(),
    classeContaminacao: id.nullable().optional(),
    itemFaturavel: id.nullable().optional(),
    procedimentoSigtap: id.nullable().optional(),
    duracaoMediaMinutos: minutos,
    tempoPreparoSalaMinutos: minutos,
    exigeLateralidade: z.boolean().optional(),
    obstetrico: z.boolean().optional(),
    hemodinamica: z.boolean().optional(),
    exigeExameImagem: z.boolean().optional(),
    exigePlano: z.boolean().optional(),
    orientacaoPaciente: z.string().max(4000).nullable().optional(),
    preparo: z.string().max(4000).nullable().optional(),
  })
  .strict();
type Entrada = z.infer<typeof esquema>;

const SQL = `
  SELECT p.id, p.codigo, p.descricao, p.mnemonico, p.natureza, p.grupo_procedimento_cirurgico_id,
         p.porte_cirurgico_id, p.especialidade_medica_id, p.carater_cirurgia_id, p.tipo_anestesia_id,
         p.via_acesso_cirurgico_id, p.classe_contaminacao_cirurgica_id, p.item_faturavel_id, p.procedimento_sigtap_id,
         i.codigo AS item_codigo, i.descricao AS item_descricao, s.codigo_sigtap, s.descricao AS sigtap_descricao,
         p.duracao_media_minutos, p.tempo_preparo_sala_minutos, p.exige_lateralidade, p.obstetrico, p.hemodinamica,
         p.exige_exame_imagem, p.exige_plano, p.orientacao_paciente, p.preparo, p.ativo, p.origem, p.versao,
         g.descricao AS grupo_descricao, po.descricao AS porte_descricao, e.descricao AS especialidade_descricao,
         c.descricao AS carater_descricao,
         (SELECT COUNT(*) FROM texto_padrao_cirurgia t
           WHERE t.procedimento_cirurgico_id = p.id AND t.ativo = 1) AS textos_padrao
    FROM procedimento_cirurgico p
    LEFT JOIN grupo_procedimento_cirurgico g ON g.id = p.grupo_procedimento_cirurgico_id
    LEFT JOIN porte_cirurgico po ON po.id = p.porte_cirurgico_id
    LEFT JOIN especialidade_medica e ON e.id = p.especialidade_medica_id
    LEFT JOIN carater_cirurgia c ON c.id = p.carater_cirurgia_id
    LEFT JOIN item_faturavel i ON i.id = p.item_faturavel_id
    LEFT JOIN procedimento_sigtap s ON s.id = p.procedimento_sigtap_id`;

function lido(x: Linha): ProcedimentoCirurgicoLido {
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    mnemonico: txtOuNull(x['mnemonico']),
    natureza: String(x['natureza']),
    grupo: numOuNull(x['grupo_procedimento_cirurgico_id']),
    grupoDescricao: txtOuNull(x['grupo_descricao']),
    porte: numOuNull(x['porte_cirurgico_id']),
    porteDescricao: txtOuNull(x['porte_descricao']),
    especialidade: numOuNull(x['especialidade_medica_id']),
    especialidadeDescricao: txtOuNull(x['especialidade_descricao']),
    carater: numOuNull(x['carater_cirurgia_id']),
    caraterDescricao: txtOuNull(x['carater_descricao']),
    tipoAnestesia: numOuNull(x['tipo_anestesia_id']),
    viaAcesso: numOuNull(x['via_acesso_cirurgico_id']),
    classeContaminacao: numOuNull(x['classe_contaminacao_cirurgica_id']),
    itemFaturavel: numOuNull(x['item_faturavel_id']),
    itemFaturavelCodigo: txtOuNull(x['item_codigo']),
    itemFaturavelDescricao: txtOuNull(x['item_descricao']),
    procedimentoSigtap: numOuNull(x['procedimento_sigtap_id']),
    sigtapCodigo: txtOuNull(x['codigo_sigtap']),
    sigtapDescricao: txtOuNull(x['sigtap_descricao']),
    duracaoMediaMinutos: numOuNull(x['duracao_media_minutos']),
    tempoPreparoSalaMinutos: numOuNull(x['tempo_preparo_sala_minutos']),
    exigeLateralidade: bool(x['exige_lateralidade']),
    obstetrico: bool(x['obstetrico']),
    hemodinamica: bool(x['hemodinamica']),
    exigeExameImagem: bool(x['exige_exame_imagem']),
    exigePlano: bool(x['exige_plano']),
    orientacaoPaciente: txtOuNull(x['orientacao_paciente']),
    preparo: txtOuNull(x['preparo']),
    ativo: bool(x['ativo']),
    origem: String(x['origem']),
    textosPadrao: num(x['textos_padrao']),
    versao: num(x['versao']),
  };
}

/** Os cadastros ligados: a coluna do procedimento, a tabela do cadastro e o nome na mensagem. */
const LIGADOS = [
  { campo: 'grupo', coluna: 'grupo_procedimento_cirurgico_id', nome: 'Grupo cirúrgico' },
  { campo: 'porte', coluna: 'porte_cirurgico_id', nome: 'Porte cirúrgico' },
  { campo: 'especialidade', coluna: 'especialidade_medica_id', nome: 'Especialidade' },
  { campo: 'carater', coluna: 'carater_cirurgia_id', nome: 'Caráter da cirurgia' },
  { campo: 'tipoAnestesia', coluna: 'tipo_anestesia_id', nome: 'Tipo de anestesia' },
  { campo: 'viaAcesso', coluna: 'via_acesso_cirurgico_id', nome: 'Via de acesso' },
  { campo: 'classeContaminacao', coluna: 'classe_contaminacao_cirurgica_id', nome: 'Classe de contaminação' },
  { campo: 'itemFaturavel', coluna: 'item_faturavel_id', nome: 'Item cobrado' },
  { campo: 'procedimentoSigtap', coluna: 'procedimento_sigtap_id', nome: 'Procedimento SUS' },
] as const;

/** Tipos do item cobrado que podem ser o código de um procedimento cirúrgico na conta (TISS). */
const TIPOS_ITEM_PROCEDIMENTO = ['procedimento', 'pacote'];

/** A situação (existe, em uso) de um item de cadastro ligado; uma consulta por tabela, com nome literal. */
async function situacaoLigado(
  l: Leitor,
  campo: (typeof LIGADOS)[number]['campo'],
  id: number,
): Promise<{ ativo: boolean; tipoItem?: string } | null> {
  let r: Linha | null | undefined;
  if (campo === 'itemFaturavel') {
    r = await l.uma('SELECT situacao, tipo_item FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [
      id,
    ]);
    return r ? { ativo: r['situacao'] === 'ativo', tipoItem: String(r['tipo_item']) } : null;
  }
  if (campo === 'procedimentoSigtap') {
    r = await l.uma(
      'SELECT (ativo = 1 AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE())) AS ativo FROM procedimento_sigtap WHERE id = ?',
      [id],
    );
    return r ? { ativo: bool(r['ativo']) } : null;
  }
  if (campo === 'grupo') r = await l.uma('SELECT ativo FROM grupo_procedimento_cirurgico WHERE id = ?', [id]);
  else if (campo === 'porte') r = await l.uma('SELECT ativo FROM porte_cirurgico WHERE id = ?', [id]);
  else if (campo === 'especialidade')
    r = await l.uma('SELECT ativo FROM especialidade_medica WHERE id = ?', [id]);
  else if (campo === 'carater') r = await l.uma('SELECT ativo FROM carater_cirurgia WHERE id = ?', [id]);
  else if (campo === 'viaAcesso')
    r = await l.uma('SELECT ativo FROM via_acesso_cirurgico WHERE id = ?', [id]);
  else if (campo === 'classeContaminacao')
    r = await l.uma('SELECT ativo FROM classe_contaminacao_cirurgica WHERE id = ?', [id]);
  else r = await l.uma('SELECT ativo FROM tipo_anestesia WHERE id = ?', [id]);
  return r ? { ativo: bool(r['ativo']) } : null;
}

const opcoes = (rs: Linha[]): OpcaoCadastro[] =>
  rs.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) }));

const itensDeCatalogo = (rs: Linha[]): ItemDeCatalogo[] =>
  rs.map((r) => ({ id: num(r['id']), codigo: String(r['codigo']), descricao: String(r['descricao']) }));

/** O termo da busca como padrão LIKE escapado (o `%` e o `_` digitados valem como texto). */
const padraoLike = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * A busca de procedimentos do agendamento (mapa cirúrgico) com as sugestões do cadastro: o caráter e a anestesia
 * sugeridos e a duração (a média do procedimento ou, sem ela, a de referência do porte). Só procedimentos em uso.
 */
export async function buscarProcedimentosComSugestao(
  l: Leitor,
  q: string,
): Promise<ProcedimentoComSugestao[]> {
  const termo = q.trim();
  if (!termo) return [];
  const like = padraoLike(termo);
  const rs = await l.consultar<Linha>(
    `SELECT p.id, p.descricao, p.carater_cirurgia_id, p.tipo_anestesia_id, p.duracao_media_minutos,
            po.duracao_referencia_minutos
       FROM procedimento_cirurgico p
       LEFT JOIN porte_cirurgico po ON po.id = p.porte_cirurgico_id
      WHERE p.excluido_em IS NULL AND p.ativo = TRUE AND (p.descricao LIKE ? OR p.codigo LIKE ? OR p.mnemonico LIKE ?)
      ORDER BY p.descricao LIMIT 50`,
    [like, like, like],
  );
  return rs.map((x) => ({
    codigo: num(x['id']),
    nome: String(x['descricao']),
    carater: numOuNull(x['carater_cirurgia_id']),
    anestesia: numOuNull(x['tipo_anestesia_id']),
    duracaoMin: duracaoSugeridaProcedimento(
      numOuNull(x['duracao_media_minutos']),
      numOuNull(x['duracao_referencia_minutos']),
    ),
  }));
}

export class PortaProcedimentoCirurgicoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [TABELA], 'cirurgia.procedimento');
  }

  /** A lista do cadastro: busca por código, descrição ou abreviação; os fora de uso só quando pedidos. */
  listar(
    c: ContextoPortaPropria,
    filtro: { q?: string; todos?: boolean },
  ): Promise<{ itens: ProcedimentoCirurgicoLido[]; truncado: boolean }> {
    return this.ler(c, 'listar', async (l) => {
      const onde = ['p.excluido_em IS NULL'];
      const args: unknown[] = [];
      if (!filtro.todos) onde.push('p.ativo = 1');
      const q = (filtro.q ?? '').trim();
      if (q) {
        onde.push('(p.codigo LIKE ? OR p.descricao LIKE ? OR p.mnemonico LIKE ?)');
        const like = padraoLike(q);
        args.push(like, like, like);
      }
      const rs = await l.consultar<Linha>(
        `${SQL} WHERE ${onde.join(' AND ')} ORDER BY p.descricao, p.id LIMIT 501`,
        args,
      );
      return { itens: rs.slice(0, 500).map(lido), truncado: rs.length > 500 };
    });
  }

  obter(c: ContextoPortaPropria, procedimento: number): Promise<ProcedimentoCirurgicoLido> {
    return this.ler(c, 'obter', async (l) => {
      const r = await l.uma(`${SQL} WHERE p.id = ? AND p.excluido_em IS NULL`, [procedimento]);
      if (!r) throw naoEncontrado('Procedimento cirúrgico');
      return lido(r);
    });
  }

  /** As opções dos combos do cadastro (só os itens em uso). */
  apoio(c: ContextoPortaPropria): Promise<ApoioProcedimentoCirurgico> {
    return this.ler(c, 'apoio', async (l) => {
      const grupos = await l.consultar<Linha>(
        `SELECT g.id, CASE WHEN s.id IS NULL THEN g.descricao ELSE CONCAT(s.descricao, ' › ', g.descricao) END AS descricao
           FROM grupo_procedimento_cirurgico g
           LEFT JOIN grupo_procedimento_cirurgico s ON s.id = g.grupo_superior_id
          WHERE g.ativo = 1 ORDER BY descricao LIMIT 1000`,
      );
      const portes = await l.consultar<Linha>(
        `SELECT id, descricao, duracao_referencia_minutos FROM porte_cirurgico
          WHERE ativo = 1 ORDER BY ordem, descricao LIMIT 200`,
      );
      const especialidades = await l.consultar<Linha>(
        'SELECT id, descricao FROM especialidade_medica WHERE ativo = 1 ORDER BY descricao LIMIT 1000',
      );
      const carateres = await l.consultar<Linha>(
        'SELECT id, descricao FROM carater_cirurgia WHERE ativo = 1 ORDER BY descricao LIMIT 200',
      );
      const anestesias = await l.consultar<Linha>(
        'SELECT id, descricao FROM tipo_anestesia WHERE ativo = 1 ORDER BY descricao LIMIT 200',
      );
      const vias = await l.consultar<Linha>(
        'SELECT id, descricao FROM via_acesso_cirurgico WHERE ativo = 1 ORDER BY descricao LIMIT 200',
      );
      const classes = await l.consultar<Linha>(
        'SELECT id, descricao FROM classe_contaminacao_cirurgica WHERE ativo = 1 ORDER BY codigo, descricao LIMIT 50',
      );
      return {
        grupos: opcoes(grupos),
        portes: portes.map((r) => ({
          id: num(r['id']),
          descricao: String(r['descricao']),
          duracaoReferenciaMinutos: numOuNull(r['duracao_referencia_minutos']),
        })),
        especialidades: opcoes(especialidades),
        carateres: opcoes(carateres),
        anestesias: opcoes(anestesias),
        vias: opcoes(vias),
        classesContaminacao: opcoes(classes),
      };
    });
  }

  /** A busca do item cobrado (TUSS ou tabela própria) em uso, do tipo procedimento ou pacote: por código ou descrição. */
  buscarItensFaturaveis(c: ContextoPortaPropria, q: string): Promise<ItemDeCatalogo[]> {
    return this.ler(c, 'buscarItensFaturaveis', async (l) => {
      const termo = q.trim();
      if (termo.length < 2) return [];
      const like = padraoLike(termo);
      return itensDeCatalogo(
        await l.consultar<Linha>(
          `SELECT id, codigo, descricao FROM item_faturavel
            WHERE excluido_em IS NULL AND situacao = 'ativo' AND tipo_item IN ('procedimento','pacote')
              AND (codigo LIKE ? OR descricao LIKE ?)
            ORDER BY descricao, id LIMIT 30`,
          [like, like],
        ),
      );
    });
  }

  /** A busca do procedimento SUS vigente: pelo código de 10 dígitos ou pela descrição. */
  buscarSigtap(c: ContextoPortaPropria, q: string): Promise<ItemDeCatalogo[]> {
    return this.ler(c, 'buscarSigtap', async (l) => {
      const termo = q.trim();
      if (termo.length < 2) return [];
      const like = padraoLike(termo);
      return itensDeCatalogo(
        await l.consultar<Linha>(
          `SELECT id, codigo_sigtap AS codigo, descricao FROM procedimento_sigtap
            WHERE ativo = 1 AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE())
              AND (codigo_sigtap LIKE ? OR descricao LIKE ?)
            ORDER BY descricao, id LIMIT 30`,
          [like, like],
        ),
      );
    });
  }

  private async conferir(tx: Leitor, e: Entrada, atual: Linha | null): Promise<void> {
    const problemas = validarProcedimentoCirurgico({
      codigo: e.codigo,
      descricao: e.descricao,
      mnemonico: e.mnemonico ?? null,
      natureza: e.natureza,
      grupo: e.grupo,
      porte: e.porte,
      especialidade: e.especialidade,
      carater: e.carater ?? null,
      duracaoMediaMinutos: e.duracaoMediaMinutos ?? null,
      tempoPreparoSalaMinutos: e.tempoPreparoSalaMinutos ?? null,
      obstetrico: e.obstetrico ?? false,
      hemodinamica: e.hemodinamica ?? false,
    });
    if (problemas.length) throw recusaRegra('Procedimento cirúrgico recusado', problemas);
    for (const x of LIGADOS) {
      const valor = e[x.campo] ?? null;
      if (valor === null) continue;
      const s = await situacaoLigado(tx, x.campo, valor);
      if (!s) throw naoEncontrado(x.nome);
      if (s.tipoItem !== undefined && !TIPOS_ITEM_PROCEDIMENTO.includes(s.tipoItem))
        throw recusaRegra('Procedimento cirúrgico recusado', [
          { campo: x.campo, mensagem: 'O item cobrado precisa ser um procedimento ou um pacote.' },
        ]);
      if (!s.ativo && numOuNull(atual?.[x.coluna]) !== valor)
        throw recusaRegra('Procedimento cirúrgico recusado', [
          { campo: x.campo, mensagem: `${x.nome} fora de uso: escolha outro.` },
        ]);
    }
    const dup = await tx.uma('SELECT id FROM procedimento_cirurgico WHERE codigo = ? AND id <> ?', [
      normalizarCodigoProcedimento(e.codigo),
      num(atual?.['id']),
    ]);
    if (dup)
      throw new ErroOperacao(
        409,
        'codigo-repetido',
        'Código repetido',
        'Já existe um procedimento cirúrgico com este código (em uso ou fora de uso).',
      );
  }

  private colunas(e: Entrada) {
    const texto = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    return {
      codigo: normalizarCodigoProcedimento(e.codigo),
      descricao: e.descricao.trim(),
      mnemonico: texto(e.mnemonico),
      natureza: e.natureza,
      grupo_procedimento_cirurgico_id: e.grupo,
      porte_cirurgico_id: e.porte,
      especialidade_medica_id: e.especialidade,
      carater_cirurgia_id: e.carater ?? null,
      tipo_anestesia_id: e.tipoAnestesia ?? null,
      via_acesso_cirurgico_id: e.viaAcesso ?? null,
      classe_contaminacao_cirurgica_id: e.classeContaminacao ?? null,
      item_faturavel_id: e.itemFaturavel ?? null,
      procedimento_sigtap_id: e.procedimentoSigtap ?? null,
      duracao_media_minutos: e.duracaoMediaMinutos ?? null,
      tempo_preparo_sala_minutos: e.tempoPreparoSalaMinutos ?? null,
      exige_lateralidade: e.exigeLateralidade ?? false,
      obstetrico: e.obstetrico ?? false,
      hemodinamica: e.hemodinamica ?? false,
      exige_exame_imagem: e.exigeExameImagem ?? false,
      exige_plano: e.exigePlano ?? false,
      orientacao_paciente: texto(e.orientacaoPaciente),
      preparo: texto(e.preparo),
    };
  }

  async incluir(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquema, entrada);
    return this.gravar(c, 'cirurgia.procedimento.incluir', [TABELA], async (tx: TxOperacao) => {
      await this.conferir(tx, e, null);
      const novo = await tx.incluir(TABELA, { ...this.colunas(e), ativo: true, origem: 'sistema' });
      return { tabela: TABELA, id: novo };
    });
  }

  async alterar(c: ContextoPortaPropria, procedimento: number, entrada: unknown): Promise<{ id: number }> {
    const { versao, ...e } = entradaValida(esquema.extend({ versao: id }).strict(), entrada);
    return this.gravar(c, 'cirurgia.procedimento.alterar', [TABELA], async (tx: TxOperacao) => {
      const atual = await tx.uma(
        `SELECT id, grupo_procedimento_cirurgico_id, porte_cirurgico_id, especialidade_medica_id,
                carater_cirurgia_id, tipo_anestesia_id, via_acesso_cirurgico_id,
                classe_contaminacao_cirurgica_id, item_faturavel_id, procedimento_sigtap_id
           FROM procedimento_cirurgico WHERE id = ? AND excluido_em IS NULL`,
        [procedimento],
      );
      if (!atual) throw naoEncontrado('Procedimento cirúrgico');
      await this.conferir(tx, e, atual);
      await tx.alterar(TABELA, procedimento, versao, this.colunas(e));
      return { tabela: TABELA, id: procedimento };
    });
  }

  /** Tira de uso ou volta ao uso (nunca apaga: agendamentos, atos e textos padrão apontam para o procedimento). */
  async definirUso(c: ContextoPortaPropria, procedimento: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(z.object({ ativo: z.boolean(), versao: id }).strict(), entrada);
    return this.gravar(c, 'cirurgia.procedimento.uso', [TABELA], async (tx) => {
      const atual = await tx.uma(
        'SELECT id FROM procedimento_cirurgico WHERE id = ? AND excluido_em IS NULL',
        [procedimento],
      );
      if (!atual) throw naoEncontrado('Procedimento cirúrgico');
      await tx.alterar(TABELA, procedimento, x.versao, { ativo: x.ativo });
      return { tabela: TABELA, id: procedimento };
    });
  }
}
