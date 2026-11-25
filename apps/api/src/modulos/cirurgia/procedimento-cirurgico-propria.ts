// Cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91), no banco do cliente (`procedimento_cirurgico`).
// Contrato de efeito:
//   - incluir: uma linha com o código normalizado (maiúsculas), descrição, abreviação, grupo, porte, especialidade,
//     natureza, caráter e anestesia sugeridos, duração média, preparo da sala e as exigências do agendamento, em uso e
//     com origem 'sistema'; código repetido é recusado (409) antes do banco; a regra do domínio
//     (validarProcedimentoCirurgico) recusa com 422 sem escrita;
//   - alterar: a mesma linha com a versão lida (+1); a anterior fica na trilha;
//   - tirar de uso / voltar ao uso: `ativo` com a versão; nada é apagado (agendamentos, atos e textos padrão apontam
//     para o procedimento);
//   - cadastros ligados: grupo, porte, especialidade, caráter e anestesia precisam existir; um que está fora de uso só
//     é aceito se já era o valor gravado (o cadastro antigo não trava a alteração de outro campo);
//   - escopo: o procedimento é do cliente (vale em todos os estabelecimentos), como o texto padrão que se liga a ele.
import { normalizarCodigoProcedimento, validarProcedimentoCirurgico } from '@sgh/dominio-cirurgia';
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
    LEFT JOIN carater_cirurgia c ON c.id = p.carater_cirurgia_id`;

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
] as const;

/** A situação (existe, em uso) de um item de cadastro ligado; uma consulta por tabela, com nome literal. */
async function situacaoLigado(l: Leitor, campo: (typeof LIGADOS)[number]['campo'], id: number) {
  let r: Linha | null | undefined;
  if (campo === 'grupo') r = await l.uma('SELECT ativo FROM grupo_procedimento_cirurgico WHERE id = ?', [id]);
  else if (campo === 'porte') r = await l.uma('SELECT ativo FROM porte_cirurgico WHERE id = ?', [id]);
  else if (campo === 'especialidade')
    r = await l.uma('SELECT ativo FROM especialidade_medica WHERE id = ?', [id]);
  else if (campo === 'carater') r = await l.uma('SELECT ativo FROM carater_cirurgia WHERE id = ?', [id]);
  else r = await l.uma('SELECT ativo FROM tipo_anestesia WHERE id = ?', [id]);
  return r ? { ativo: bool(r['ativo']) } : null;
}

const opcoes = (rs: Linha[]): OpcaoCadastro[] =>
  rs.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) }));

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
        const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
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
      };
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
                carater_cirurgia_id, tipo_anestesia_id
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
