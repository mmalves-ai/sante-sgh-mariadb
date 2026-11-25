// C2-048 (04-INT linha 70), no banco do cliente: plano previsto da pré-internação e fila de espera eletiva. As regras
// são as puras de @sgh/dominio-internacao (pre-internacao-plano.ts); aqui ficam a leitura e a gravação pelo executor
// (trilha na mesma transação). Contrato de efeito:
//   - o plano grava `agendamento_internacao_procedimento` (item faturável, quantidade, principal, via de acesso, se
//     entra na guia), `agendamento_internacao_material` (insumo, quantidade, unidade de estoque do insumo, fornecedor,
//     observação) e `agendamento_internacao_profissional` (profissional e função na equipe), sempre a lista inteira com
//     a versão lida da pré-internação (versão velha: 409, nada gravado). O que sai do plano é marcado como excluído
//     (excluido_em, excluido_por), nunca apagado; o que volta reaproveita a linha antiga; o novo entra no fim da
//     sequência. A pré-internação ganha versão nova a cada gravação do plano;
//   - o procedimento principal é um só: o previsto da pré-internação (agendamento_internacao.item_faturavel_id ou,
//     pelo SUS, procedimento_sigtap_id), o mesmo que a lista das pré-internações e a fila mostram. A leitura do plano
//     parte dele (marca a linha ou a põe à frente); a gravação passa o principal do plano para o previsto na mesma
//     transação. Pelo SUS, os itens do plano são secundários e marcar um principal é recusado (422);
//   - o fornecedor previsto do material (consignado ou OPME) é buscado entre os fornecedores ativos e conferido;
//   - pré-internação internada, cancelada ou com falta não muda de plano (422); item, insumo, profissional, função ou
//     fornecedor inexistente ou fora de uso é recusado (422, com o campo), nunca gravado;
//   - a fila de espera é a pré-internação sem data (situação 'em_espera'), na ordem do domínio (prioridade clínica, data
//     do pedido); a posição é calculada na leitura. A mudança de prioridade grava `prioridade` com a versão e acrescenta
//     a justificativa datada à observação (nada se perde).
import {
  alinharPrincipalLido,
  conferirMudancaPrioridade,
  diasDeEspera,
  diferencaPlano,
  type LinhaPlanoGravada,
  ordenarFilaEspera,
  planoEditavel,
  PRIORIDADES_FILA_INTERNACAO,
  type PrioridadeFilaInternacao,
  type PlanoPreEntrada,
  type ProblemaPlanoPre,
  type ProcedimentoPrevistoPre,
  validarPlanoPreInternacao,
  VIAS_ACESSO_PROCEDIMENTO,
} from '@sgh/dominio-internacao';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  type NucleoPortaPropria,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_PRE_INTERNACAO_PLANO = Symbol('PORTA_PRE_INTERNACAO_PLANO');

const T_PRE = 'agendamento_internacao';
const T_PROC = 'agendamento_internacao_procedimento';
const T_MAT = 'agendamento_internacao_material';
const T_EQP = 'agendamento_internacao_profissional';
const TABELAS = [T_PRE, T_PROC, T_MAT, T_EQP];

const id = z.number().int().positive();
const quantidade = z.number().positive().max(99_999);

const esquemaPlano = z
  .object({
    versao: id,
    procedimentos: z
      .array(
        z
          .object({
            item: id,
            quantidade: quantidade.default(1),
            principal: z.boolean().default(false),
            viaAcesso: z.enum(VIAS_ACESSO_PROCEDIMENTO).nullable().default(null),
            incluirNaGuia: z.boolean().default(true),
          })
          .strict(),
      )
      .max(60),
    materiais: z
      .array(
        z
          .object({
            insumo: id,
            quantidade,
            fornecedor: id.nullable().default(null),
            observacao: z.string().max(500).nullable().default(null),
          })
          .strict(),
      )
      .max(60),
    equipe: z.array(z.object({ profissional: id, funcao: id }).strict()).max(60),
  })
  .strict();

const esquemaPrioridade = z
  .object({
    versao: id,
    prioridade: z.enum(PRIORIDADES_FILA_INTERNACAO),
    justificativa: z.string().max(500),
  })
  .strict();

export interface PlanoPreLido {
  readonly preInternacao: number;
  readonly numero: string;
  readonly paciente: number;
  readonly situacao: string;
  readonly prioridade: PrioridadeFilaInternacao;
  readonly editavel: boolean;
  readonly versao: number;
  /** Pré-internação pelo SUS: o procedimento principal, da tabela do SUS (os itens do plano são secundários). */
  readonly procedimentoSus: { readonly codigo: string; readonly descricao: string } | null;
  readonly procedimentos: {
    readonly item: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly quantidade: number;
    readonly principal: boolean;
    readonly viaAcesso: string | null;
    readonly incluirNaGuia: boolean;
  }[];
  readonly materiais: {
    readonly insumo: number;
    readonly codigo: string;
    readonly nome: string;
    readonly unidade: string | null;
    readonly quantidade: number;
    readonly fornecedor: number | null;
    readonly fornecedorNome: string | null;
    readonly observacao: string | null;
  }[];
  readonly equipe: {
    readonly profissional: number;
    readonly nome: string;
    readonly funcao: number;
    readonly funcaoDescricao: string;
  }[];
}

export interface EsperaLida {
  readonly preInternacao: number;
  readonly numero: string;
  readonly paciente: number;
  readonly nome: string;
  readonly prontuario: number | null;
  readonly prioridade: PrioridadeFilaInternacao;
  readonly solicitadoEm: string;
  readonly diasEspera: number;
  readonly posicao: number;
  readonly especialidade: string | null;
  readonly procedimentoPrincipal: string | null;
  readonly procedimentos: number;
  readonly materiais: number;
  readonly equipe: number;
  readonly versao: number;
}

const iso = (v: unknown): string => new Date(v as string).toISOString();
const recusou = (titulo: string, p: readonly ProblemaPlanoPre[]): never => {
  throw recusaRegra(titulo, p);
};
const conflito = () =>
  new ErroOperacao(409, 'conflito-versao', 'Registro alterado', 'A pré-internação mudou desde a leitura.', {
    colunas: ['versao'],
  });
const like = (termo: string) => `%${termo.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

const SQL_PRE = `SELECT id, numero, paciente_id, situacao, prioridade, observacao, versao, item_faturavel_id,
       procedimento_sigtap_id FROM agendamento_internacao
  WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;

const previstoDe = (a: Record<string, unknown>): ProcedimentoPrevistoPre => ({
  item: numOuNull(a['item_faturavel_id']),
  sus: a['procedimento_sigtap_id'] !== null && a['procedimento_sigtap_id'] !== undefined,
});

// Todas as linhas do plano (inclusive as que saíram), travadas, com a chave natural de cada lista.
const SQL_LINHAS_PROC = `SELECT id, sequencia, versao, excluido_em, item_faturavel_id AS chave
  FROM agendamento_internacao_procedimento WHERE agendamento_internacao_id = ?`;
const SQL_LINHAS_MAT = `SELECT id, sequencia, versao, excluido_em, insumo_id AS chave
  FROM agendamento_internacao_material WHERE agendamento_internacao_id = ?`;
const SQL_LINHAS_EQP = `SELECT id, sequencia, versao, excluido_em,
       CONCAT(profissional_id, ':', funcao_equipe_cirurgica_id) AS chave
  FROM agendamento_internacao_profissional WHERE agendamento_internacao_id = ?`;

export class PortaPreInternacaoPlanoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: NucleoPortaPropria, cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.pre-internacao-plano');
  }

  // ── Apoio e buscas ──

  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l) => ({
      funcoes: (
        await l.consultar(
          'SELECT id, descricao FROM funcao_equipe_cirurgica WHERE ativo ORDER BY ordem, descricao',
        )
      ).map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) })),
      prioridades: PRIORIDADES_FILA_INTERNACAO,
      viasAcesso: VIAS_ACESSO_PROCEDIMENTO,
    }));
  }

  buscarItens(c: ContextoPortaPropria, termo: string) {
    if (termo.trim().length < 2) return Promise.resolve([]);
    return this.ler(c, 'busca-itens', async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo, descricao FROM item_faturavel
            WHERE situacao = 'ativo' AND excluido_em IS NULL AND (codigo = ? OR descricao LIKE ?)
            ORDER BY codigo = ? DESC, descricao LIMIT 20`,
          [termo.trim(), like(termo), termo.trim()],
        )
      ).map((r) => ({ id: num(r['id']), codigo: String(r['codigo']), descricao: String(r['descricao']) })),
    );
  }

  buscarInsumos(c: ContextoPortaPropria, termo: string) {
    if (termo.trim().length < 2) return Promise.resolve([]);
    return this.ler(c, 'busca-insumos', async (l) =>
      (
        await l.consultar(
          `SELECT i.id, i.codigo, i.nome, u.sigla FROM insumo i
             LEFT JOIN unidade_medida u ON u.id = i.estoque_unidade_medida_id
            WHERE i.situacao = 'ativo' AND i.excluido_em IS NULL AND (i.codigo = ? OR i.nome LIKE ?)
            ORDER BY i.codigo = ? DESC, i.nome LIMIT 20`,
          [termo.trim(), like(termo), termo.trim()],
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        unidade: txtOuNull(r['sigla']),
      })),
    );
  }

  buscarProfissionais(c: ContextoPortaPropria, termo: string) {
    if (termo.trim().length < 2) return Promise.resolve([]);
    return this.ler(c, 'busca-profissionais', async (l) =>
      (
        await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL AND (pf.nome LIKE ? OR pr.nome_exibicao LIKE ?)
            ORDER BY nome LIMIT 20`,
          [like(termo), like(termo)],
        )
      ).map((r) => ({ id: num(r['id']), nome: String(r['nome']) })),
    );
  }

  /** Fornecedores ativos (razão social, nome fantasia ou CNPJ/CPF), para o material consignado ou OPME. */
  buscarFornecedores(c: ContextoPortaPropria, termo: string) {
    if (termo.trim().length < 2) return Promise.resolve([]);
    const doc = termo.replace(/\D/g, '');
    return this.ler(c, 'busca-fornecedores', async (l) =>
      (
        await l.consultar(
          `SELECT id, razao_social, nome_fantasia, fornece_opme FROM empresa_fornecedora
            WHERE situacao = 'ativo' AND excluido_em IS NULL
              AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj = ? OR cpf = ?)
            ORDER BY fornece_opme DESC, razao_social LIMIT 20`,
          [like(termo), like(termo), doc || '-', doc || '-'],
        )
      ).map((r) => ({
        id: num(r['id']),
        nome: String(r['razao_social']),
        fantasia: txtOuNull(r['nome_fantasia']),
        opme: bool(r['fornece_opme']),
      })),
    );
  }

  // ── Plano ──

  private async lerPlano(l: Leitor, est: number, pre: number): Promise<PlanoPreLido> {
    const a = await l.uma(SQL_PRE, [pre, est]);
    if (!a) throw naoEncontrado('Pré-internação');
    const procedimentos = await l.consultar(
      `SELECT p.item_faturavel_id, i.codigo, i.descricao, p.quantidade, p.principal, p.via_acesso, p.incluir_na_guia
         FROM agendamento_internacao_procedimento p JOIN item_faturavel i ON i.id = p.item_faturavel_id
        WHERE p.agendamento_internacao_id = ? AND p.excluido_em IS NULL ORDER BY p.principal DESC, p.sequencia`,
      [pre],
    );
    const materiais = await l.consultar(
      `SELECT m.insumo_id, i.codigo, i.nome, u.sigla, m.quantidade, m.empresa_fornecedora_id, f.razao_social,
              m.observacao
         FROM agendamento_internacao_material m JOIN insumo i ON i.id = m.insumo_id
         LEFT JOIN unidade_medida u ON u.id = m.unidade_medida_id
         LEFT JOIN empresa_fornecedora f ON f.id = m.empresa_fornecedora_id
        WHERE m.agendamento_internacao_id = ? AND m.excluido_em IS NULL ORDER BY m.sequencia`,
      [pre],
    );
    const equipe = await l.consultar(
      `SELECT e.profissional_id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, e.funcao_equipe_cirurgica_id,
              fe.descricao
         FROM agendamento_internacao_profissional e
         JOIN profissional pr ON pr.id = e.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
         JOIN funcao_equipe_cirurgica fe ON fe.id = e.funcao_equipe_cirurgica_id
        WHERE e.agendamento_internacao_id = ? AND e.excluido_em IS NULL ORDER BY fe.ordem, e.sequencia`,
      [pre],
    );
    const situacao = String(a['situacao']);
    const previsto = previstoDe(a);
    const sus = previsto.sus
      ? await l.uma('SELECT codigo_sigtap, descricao FROM procedimento_sigtap WHERE id = ?', [
          a['procedimento_sigtap_id'],
        ])
      : null;
    const linhaPrevista =
      previsto.item === null
        ? null
        : await l.uma(
            `SELECT id AS item_faturavel_id, codigo, descricao, 1 AS quantidade, TRUE AS principal, NULL AS via_acesso,
                    TRUE AS incluir_na_guia FROM item_faturavel WHERE id = ?`,
            [previsto.item],
          );
    const procLido = (r: Record<string, unknown>) => ({
      item: num(r['item_faturavel_id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      quantidade: Number(r['quantidade']),
      principal: bool(r['principal']),
      viaAcesso: txtOuNull(r['via_acesso']),
      incluirNaGuia: bool(r['incluir_na_guia']),
    });
    return {
      preInternacao: num(a['id']),
      numero: String(a['numero']),
      paciente: num(a['paciente_id']),
      situacao,
      prioridade: String(a['prioridade']) as PrioridadeFilaInternacao,
      editavel: planoEditavel(situacao),
      versao: num(a['versao']),
      procedimentoSus: sus
        ? { codigo: String(sus['codigo_sigtap']), descricao: String(sus['descricao']) }
        : null,
      procedimentos: alinharPrincipalLido(procedimentos.map(procLido), previsto, () =>
        linhaPrevista ? procLido(linhaPrevista) : null,
      ),
      materiais: materiais.map((r) => ({
        insumo: num(r['insumo_id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        unidade: txtOuNull(r['sigla']),
        quantidade: Number(r['quantidade']),
        fornecedor: numOuNull(r['empresa_fornecedora_id']),
        fornecedorNome: txtOuNull(r['razao_social']),
        observacao: txtOuNull(r['observacao']),
      })),
      equipe: equipe.map((r) => ({
        profissional: num(r['profissional_id']),
        nome: String(r['nome']),
        funcao: num(r['funcao_equipe_cirurgica_id']),
        funcaoDescricao: String(r['descricao']),
      })),
    };
  }

  plano(c: ContextoPortaPropria, pre: number): Promise<PlanoPreLido> {
    return this.ler(c, 'plano', (l, est) => this.lerPlano(l, est.id, pre));
  }

  /** O plano da pré-internação pendente do paciente (a lista da tela é por paciente); null sem pendente. */
  planoDoPaciente(c: ContextoPortaPropria, paciente: number): Promise<PlanoPreLido | null> {
    return this.ler(c, 'plano-paciente', async (l, est) => {
      const a = await l.uma(
        `SELECT id FROM agendamento_internacao WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL
            AND situacao IN ('solicitado','aguardando_autorizacao','autorizado','confirmado','em_espera')
          ORDER BY id DESC LIMIT 1`,
        [est.id, paciente],
      );
      return a ? this.lerPlano(l, est.id, num(a['id'])) : null;
    });
  }

  async gravarPlano(c: ContextoPortaPropria, pre: number, entrada: unknown): Promise<{ versao: number }> {
    const e = entradaValida(esquemaPlano, entrada);
    return this.gravar(c, 'internacao.pre-internacao.plano', TABELAS, async (tx, est, usuario) => {
      const [a] = await tx.consultarParaAtualizar(SQL_PRE, [pre, est.id]);
      if (!a) throw naoEncontrado('Pré-internação');
      if (num(a['versao']) !== e.versao) throw conflito();
      const v = validarPlanoPreInternacao(e, String(a['situacao']), previstoDe(a));
      if (!v.ok) return recusou('Plano não gravado', v.problemas);
      const plano = v.valor;
      await this.conferirReferencias(tx, plano);
      const agora = new Date();
      const linhas = async (sql: string) =>
        (await tx.consultarParaAtualizar(sql, [pre])).map((r): LinhaPlanoGravada => ({
          id: num(r['id']),
          chave: String(r['chave']),
          sequencia: num(r['sequencia']),
          vigente: r['excluido_em'] === null,
          versao: num(r['versao']),
        }));
      const aplicar = async <V>(
        tabela: string,
        gravadas: LinhaPlanoGravada[],
        novas: readonly V[],
        chaveDe: (v: V) => string,
        colunas: (v: V) => Record<string, unknown>,
      ) => {
        const d = diferencaPlano(gravadas, novas, chaveDe);
        for (const r of d.remover)
          await tx.alterar(tabela, r.id, r.versao, { excluido_em: agora, excluido_por: usuario });
        for (const m of d.manter)
          await tx.alterar(tabela, m.id, m.versao, {
            ...colunas(m.valor),
            excluido_em: null,
            excluido_por: null,
          });
        for (const i of d.incluir)
          await tx.incluir(tabela, {
            agendamento_internacao_id: pre,
            sequencia: i.sequencia,
            origem: 'sistema',
            ...colunas(i.valor),
          });
      };
      await aplicar(
        T_PROC,
        await linhas(SQL_LINHAS_PROC),
        plano.procedimentos,
        (p) => String(p.item),
        (p) => ({
          item_faturavel_id: p.item,
          quantidade: p.quantidade,
          principal: p.principal,
          via_acesso: p.viaAcesso,
          incluir_na_guia: p.incluirNaGuia,
        }),
      );
      const unidades = new Map<number, number | null>();
      for (const m of plano.materiais) {
        const u = await tx.uma('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [m.insumo]);
        unidades.set(m.insumo, numOuNull(u?.['u']));
      }
      await aplicar(
        T_MAT,
        await linhas(SQL_LINHAS_MAT),
        plano.materiais,
        (m) => String(m.insumo),
        (m) => ({
          insumo_id: m.insumo,
          quantidade: m.quantidade,
          unidade_medida_id: unidades.get(m.insumo) ?? null,
          empresa_fornecedora_id: m.fornecedor,
          observacao: m.observacao,
        }),
      );
      await aplicar(
        T_EQP,
        await linhas(SQL_LINHAS_EQP),
        plano.equipe,
        (p) => `${p.profissional}:${p.funcao}`,
        (p) => ({ profissional_id: p.profissional, funcao_equipe_cirurgica_id: p.funcao }),
      );
      // O principal do plano é o procedimento previsto da pré-internação (uma fonte só); pelo SUS, não muda.
      const versao = await tx.alterar(
        T_PRE,
        pre,
        e.versao,
        v.principal !== null && v.principal !== numOuNull(a['item_faturavel_id'])
          ? { item_faturavel_id: v.principal }
          : {},
      );
      return { tabela: T_PRE, id: pre, versao };
    });
  }

  private async conferirReferencias(tx: TxOperacao, p: PlanoPreEntrada): Promise<void> {
    const problemas: ProblemaPlanoPre[] = [];
    const conferir = async (sql: string, valor: number, campo: string, mensagem: string) => {
      if (!(await tx.uma(sql, [valor]))) problemas.push({ campo, mensagem });
    };
    for (const [i, x] of p.procedimentos.entries())
      await conferir(
        "SELECT id FROM item_faturavel WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        x.item,
        `procedimentos.${i}.item`,
        'O procedimento não existe ou está fora de uso.',
      );
    for (const [i, x] of p.materiais.entries()) {
      await conferir(
        "SELECT id FROM insumo WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        x.insumo,
        `materiais.${i}.insumo`,
        'O material não existe ou está fora de uso.',
      );
      if (x.fornecedor !== null)
        await conferir(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
          x.fornecedor,
          `materiais.${i}.fornecedor`,
          'O fornecedor não existe ou não está ativo.',
        );
    }
    for (const [i, x] of p.equipe.entries()) {
      await conferir(
        "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        x.profissional,
        `equipe.${i}.profissional`,
        'O profissional não existe ou não está ativo.',
      );
      await conferir(
        'SELECT id FROM funcao_equipe_cirurgica WHERE id = ? AND ativo',
        x.funcao,
        `equipe.${i}.funcao`,
        'A função na equipe não existe ou está fora de uso.',
      );
    }
    if (problemas.length) recusou('Plano não gravado', problemas);
  }

  // ── Fila de espera ──

  fila(c: ContextoPortaPropria): Promise<{ itens: EsperaLida[]; contagens: Record<string, number> }> {
    return this.ler(c, 'fila', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.numero, a.paciente_id, COALESCE(p.nome_social, pf.nome) AS nome, p.numero_prontuario,
                a.prioridade, a.solicitado_em, a.versao, em.descricao AS especialidade,
                COALESCE(itf.descricao, ps.descricao) AS principal,
                (SELECT COUNT(*) FROM agendamento_internacao_procedimento x
                  WHERE x.agendamento_internacao_id = a.id AND x.excluido_em IS NULL) AS n_proc,
                (SELECT COUNT(*) FROM agendamento_internacao_material x
                  WHERE x.agendamento_internacao_id = a.id AND x.excluido_em IS NULL) AS n_mat,
                (SELECT COUNT(*) FROM agendamento_internacao_profissional x
                  WHERE x.agendamento_internacao_id = a.id AND x.excluido_em IS NULL) AS n_eqp
           FROM agendamento_internacao a
           JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN especialidade_medica em ON em.id = a.especialidade_medica_id
           LEFT JOIN item_faturavel itf ON itf.id = a.item_faturavel_id
           LEFT JOIN procedimento_sigtap ps ON ps.id = a.procedimento_sigtap_id
          WHERE a.estabelecimento_id = ? AND a.situacao = 'em_espera' AND a.excluido_em IS NULL
          LIMIT 1000`,
        [est.id],
      );
      const agora = new Date();
      const itens = ordenarFilaEspera(
        linhas.map((r) => ({
          id: num(r['id']),
          prioridade: String(r['prioridade']) as PrioridadeFilaInternacao,
          solicitadoEm: iso(r['solicitado_em']),
          r,
        })),
      ).map((x): EsperaLida => ({
        preInternacao: x.id,
        numero: String(x.r['numero']),
        paciente: num(x.r['paciente_id']),
        nome: String(x.r['nome']),
        prontuario: numOuNull(x.r['numero_prontuario']),
        prioridade: x.prioridade,
        solicitadoEm: x.solicitadoEm,
        diasEspera: diasDeEspera(x.solicitadoEm, agora),
        posicao: x.posicao,
        especialidade: txtOuNull(x.r['especialidade']),
        procedimentoPrincipal: txtOuNull(x.r['principal']),
        procedimentos: num(x.r['n_proc']),
        materiais: num(x.r['n_mat']),
        equipe: num(x.r['n_eqp']),
        versao: num(x.r['versao']),
      }));
      const contagens: Record<string, number> = { total: itens.length };
      for (const p of PRIORIDADES_FILA_INTERNACAO)
        contagens[p] = itens.filter((x) => x.prioridade === p).length;
      return { itens, contagens };
    });
  }

  async priorizar(c: ContextoPortaPropria, pre: number, entrada: unknown): Promise<{ versao: number }> {
    const e = entradaValida(esquemaPrioridade, entrada);
    return this.gravar(c, 'internacao.pre-internacao.priorizar', [T_PRE], async (tx, est) => {
      const [a] = await tx.consultarParaAtualizar(SQL_PRE, [pre, est.id]);
      if (!a) throw naoEncontrado('Pré-internação');
      if (num(a['versao']) !== e.versao) throw conflito();
      const atual = String(a['prioridade']) as PrioridadeFilaInternacao;
      const v = conferirMudancaPrioridade({
        situacao: String(a['situacao']),
        atual,
        nova: e.prioridade,
        justificativa: e.justificativa,
      });
      if (!v.ok) return recusou('Prioridade não alterada', v.problemas);
      const anterior = txtOuNull(a['observacao']);
      const linha = `[${new Date().toISOString().slice(0, 10)}] Prioridade ${atual} → ${e.prioridade}: ${v.justificativa}`;
      const versao = await tx.alterar(T_PRE, pre, e.versao, {
        prioridade: e.prioridade,
        observacao: anterior ? `${anterior}\n${linha}` : linha,
      });
      return { tabela: T_PRE, id: pre, versao };
    });
  }
}
