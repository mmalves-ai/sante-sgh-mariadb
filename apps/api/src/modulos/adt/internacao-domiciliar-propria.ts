// Internação domiciliar (C2-079, 04-INT linha 84) no banco do cliente: orçamento, transferência para casa, chamados e
// visitas. As regras são as puras de @sgh/dominio-internacao (internacao-domiciliar.ts). Contrato de efeito:
//   - orçamento: `orcamento_internacao_domiciliar` numerado (rascunho) com os itens em
//     `orcamento_internacao_domiciliar_item` e os totais calculados pelo domínio; no rascunho, salvar de novo marca os
//     itens antigos como excluídos (excluido_em/excluido_por) e grava os novos na sequência seguinte; enviar, aprovar,
//     recusar e cancelar mudam a situação (a resposta da operadora grava data_hora_resposta);
//   - transferência para casa: `internacao_domiciliar` numerada, 'solicitada', com o endereço do paciente, a origem
//     hospitalar, o orçamento aprovado (fonte e plano dele) ou a liminar, a equipe e a data prevista;
//   - ciclo: avaliar, iniciar (data_hora_inicio e equipe), suspender e retomar, encerrar (data_hora_fim; as visitas
//     agendadas que sobram são canceladas com o motivo) e cancelar; o motivo entra na observação, acrescentado com a
//     data, nunca por cima do que já havia;
//   - chamado: `chamado_domiciliar` numerado, ligado à internação domiciliar aberta do paciente (endereço, área,
//     fonte e plano dela quando o chamado não traz endereço); triar (prioridade), atribuir (profissional e
//     `visita_domiciliar` extra ligada ao chamado), concluir (desfecho, realizado_em, coparticipação) e anular (motivo;
//     a visita agendada do chamado é cancelada);
//   - visita: `visita_domiciliar` agendada; confirmar, iniciar (o chamado dela passa a 'em atendimento'), realizar
//     (início e fim), cancelar ou não realizada (motivo).
// Nada se apaga; cada ação confere a versão lida e grava a trilha pelo executor.
import {
  conferirAcaoChamadoDomiciliar,
  conferirAcaoInternacaoDomiciliar,
  conferirAcaoOrcamento,
  conferirAcaoVisitaDomiciliar,
  conferirChamadoDomiciliar,
  conferirOrcamentoDomiciliar,
  conferirTransferenciaDomicilio,
  conferirVisitaDomiciliar,
  DESFECHOS_CHAMADO_DOMICILIAR,
  MODALIDADES_ATENCAO_DOMICILIAR,
  ordenarFilaChamadosDomiciliares,
  PRIORIDADES_CHAMADO_DOMICILIAR,
  TIPOS_ITEM_ORCAMENTO_DOMICILIAR,
  TIPOS_ORCAMENTO_DOMICILIAR,
  totaisOrcamentoDomiciliar,
  valorItemOrcamento,
  type AcaoChamadoDomiciliar,
  type AcaoInternacaoDomiciliar,
  type AcaoOrcamentoDomiciliar,
  type AcaoVisitaDomiciliar,
} from '@sgh/dominio-internacao';
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

export const PORTA_INTERNACAO_DOMICILIAR = Symbol('PORTA_INTERNACAO_DOMICILIAR');

const T_ORCAMENTO = 'orcamento_internacao_domiciliar';
const T_ITEM = 'orcamento_internacao_domiciliar_item';
const T_INTERNACAO = 'internacao_domiciliar';
const T_CHAMADO = 'chamado_domiciliar';
const T_VISITA = 'visita_domiciliar';
const T_SEQUENCIA = 'sequencia_negocio';
const TABELAS = [T_ORCAMENTO, T_ITEM, T_INTERNACAO, T_CHAMADO, T_VISITA, T_SEQUENCIA];
const NUMERACAO: Record<string, string> = {
  [T_ORCAMENTO]: 'ORD-',
  [T_INTERNACAO]: 'ID-',
  [T_CHAMADO]: 'CHD-',
};

const diaNoFuso = (d: Date, fuso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(d);
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const quando = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const versao = z.number().int().positive();
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));
const dinheiro = z.number().min(0).max(9_999_999_999);

const esquemaItem = z
  .object({
    tipoItem: z.enum(TIPOS_ITEM_ORCAMENTO_DOMICILIAR),
    itemCodigo: texto(40),
    tipoCusto: idOuNull,
    descricao: z.string().trim().min(1).max(150),
    quantidade: z.number().positive().max(99_999),
    dias: z.number().int().positive().max(3650).nullable().default(null),
    valorUnitario: dinheiro,
    valorCustoUnitario: dinheiro.nullable().default(null),
    percentualAcrescimo: z.number().min(0).max(1000).nullable().default(null),
  })
  .strict();
const esquemaOrcamento = z
  .object({
    paciente: id,
    tipo: z.enum(TIPOS_ORCAMENTO_DOMICILIAR),
    modalidade: z.enum(MODALIDADES_ATENCAO_DOMICILIAR).default('internacao'),
    fontePagadora: idOuNull,
    plano: idOuNull,
    carteira: texto(30),
    programa: idOuNull,
    validade: data.nullable().default(null),
    periodoInicio: data.nullable().default(null),
    periodoFim: data.nullable().default(null),
    solicitante: idOuNull,
    solicitanteExterno: texto(150),
    diagnostico: texto(500),
    avaliacao: texto(5000),
    proposta: texto(5000),
    observacao: texto(5000),
    percentualImpostos: z.number().min(0).max(100).default(0),
    itens: z.array(esquemaItem).min(1).max(200),
    versao: versao.optional(),
  })
  .strict();
const esquemaTransferir = z
  .object({
    paciente: id,
    endereco: id,
    origemInternacao: idOuNull,
    orcamento: idOuNull,
    programa: idOuNull,
    area: idOuNull,
    motivo: idOuNull,
    medico: idOuNull,
    enfermeiro: idOuNull,
    tecnico: idOuNull,
    dataPrevista: data.nullable().default(null),
    liminarNumero: texto(50),
    liminarData: data.nullable().default(null),
    observacao: texto(5000),
  })
  .strict();
const esquemaAcaoInternacao = z
  .object({
    versao,
    quando: quando.nullable().default(null),
    motivo: texto(1000),
    medico: idOuNull,
    enfermeiro: idOuNull,
    tecnico: idOuNull,
  })
  .strict();
const esquemaChamado = z
  .object({
    paciente: id,
    tipo: id,
    motivo: idOuNull,
    chamadoEm: quando.nullable().default(null),
    prioridade: z.enum(PRIORIDADES_CHAMADO_DOMICILIAR).nullable().default(null),
    sintoma: texto(1000),
    telefone: texto(20),
    cep: z
      .string()
      .regex(/^\d{8}$/)
      .nullable()
      .default(null),
    logradouro: texto(150),
    numero: texto(10),
    complemento: texto(60),
    bairro: texto(100),
    observacao: texto(2000),
  })
  .strict();
const esquemaAcaoChamado = z
  .object({
    versao,
    prioridade: z.enum(PRIORIDADES_CHAMADO_DOMICILIAR).nullable().default(null),
    profissional: idOuNull,
    agendadaPara: quando.nullable().default(null),
    desfecho: z.enum(DESFECHOS_CHAMADO_DOMICILIAR).nullable().default(null),
    coparticipacao: dinheiro.nullable().default(null),
    motivo: texto(1000),
  })
  .strict();
const esquemaVisita = z
  .object({
    internacao: id,
    profissional: id,
    tipo: id,
    quando,
    duracao: z.number().int().nullable().default(null),
    observacao: texto(1000),
  })
  .strict();
const esquemaAcaoVisita = z
  .object({
    versao,
    inicio: quando.nullable().default(null),
    fim: quando.nullable().default(null),
    motivo: texto(300),
  })
  .strict();

const NOME_PACIENTE = `(SELECT COALESCE(p.nome_social, pf.nome) FROM paciente p
   LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = x.paciente_id)`;
const NOME_PROF = (col: string) =>
  `(SELECT COALESCE(pr.nome_exibicao, pf.nome) FROM profissional pr
     LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pr.id = x.${col})`;

const SELECT_ORCAMENTO = `SELECT x.*, DATE_FORMAT(x.data_validade, '%Y-%m-%d') AS validade_txt,
    DATE_FORMAT(x.periodo_inicio, '%Y-%m-%d') AS inicio_txt, DATE_FORMAT(x.periodo_fim, '%Y-%m-%d') AS fim_txt,
    ${NOME_PACIENTE} AS paciente_nome, (SELECT fp.nome FROM fonte_pagadora fp WHERE fp.id = x.fonte_pagadora_id) AS fonte_nome
  FROM orcamento_internacao_domiciliar x`;
const SELECT_INTERNACAO = `SELECT x.*, DATE_FORMAT(x.data_prevista_inicio, '%Y-%m-%d') AS prevista_txt,
    DATE_FORMAT(x.data_solicitacao, '%Y-%m-%d') AS solicitacao_txt, ${NOME_PACIENTE} AS paciente_nome,
    ${NOME_PROF('medico_responsavel_profissional_id')} AS medico_nome,
    (SELECT CONCAT_WS(', ', e.logradouro, e.numero, e.bairro_nome) FROM endereco_pessoa e WHERE e.id = x.endereco_pessoa_id)
      AS endereco_txt,
    (SELECT o.numero FROM orcamento_internacao_domiciliar o WHERE o.id = x.orcamento_internacao_domiciliar_id)
      AS orcamento_numero
  FROM internacao_domiciliar x`;
const SELECT_CHAMADO = `SELECT x.*, ${NOME_PACIENTE} AS paciente_nome, ${NOME_PROF('atribuido_profissional_id')} AS prof_nome,
    (SELECT t.descricao FROM tipo_chamado_domiciliar t WHERE t.id = x.tipo_chamado_domiciliar_id) AS tipo_nome,
    (SELECT m.descricao FROM motivo_chamado_domiciliar m WHERE m.id = x.motivo_chamado_domiciliar_id) AS motivo_nome
  FROM chamado_domiciliar x`;
const SELECT_VISITA = `SELECT x.*, ${NOME_PACIENTE} AS paciente_nome, ${NOME_PROF('profissional_id')} AS prof_nome,
    (SELECT t.descricao FROM tipo_chamado_domiciliar t WHERE t.id = x.tipo_chamado_domiciliar_id) AS tipo_nome
  FROM visita_domiciliar x`;

const orcamentoLido = (x: Record<string, unknown>, itens: Record<string, unknown>[]) => ({
  id: num(x['id']),
  versao: num(x['versao']),
  numero: String(x['numero']),
  paciente: num(x['paciente_id']),
  pacienteNome: txtOuNull(x['paciente_nome']),
  tipo: String(x['tipo_orcamento']),
  modalidade: String(x['modalidade_atendimento']),
  fontePagadora: numOuNull(x['fonte_pagadora_id']),
  fonteNome: txtOuNull(x['fonte_nome']),
  situacao: String(x['situacao']),
  validade: txtOuNull(x['validade_txt']),
  periodoInicio: txtOuNull(x['inicio_txt']),
  periodoFim: txtOuNull(x['fim_txt']),
  diagnostico: txtOuNull(x['diagnostico']),
  percentualImpostos: Number(x['percentual_impostos'] ?? 0),
  valorCustoTotal: Number(x['valor_custo_total'] ?? 0),
  valorImpostos: Number(x['valor_impostos'] ?? 0),
  valorTotal: Number(x['valor_total'] ?? 0),
  criadoEm: iso(x['data_hora_orcamento']),
  respostaEm: iso(x['data_hora_resposta']),
  itens: itens
    .filter((i) => num(i['orcamento_internacao_domiciliar_id']) === num(x['id']))
    .map((i) => ({
      sequencia: num(i['sequencia']),
      tipoItem: String(i['tipo_item']),
      descricao: String(i['descricao']),
      quantidade: Number(i['quantidade']),
      dias: numOuNull(i['quantidade_dias']),
      valorUnitario: Number(i['valor_unitario']),
      valorTotal: Number(i['valor_total']),
    })),
});
export type OrcamentoDomiciliarLido = ReturnType<typeof orcamentoLido>;

const internacaoLida = (x: Record<string, unknown>) => ({
  id: num(x['id']),
  versao: num(x['versao']),
  numero: String(x['numero']),
  paciente: num(x['paciente_id']),
  pacienteNome: txtOuNull(x['paciente_nome']),
  situacao: String(x['situacao']),
  endereco: txtOuNull(x['endereco_txt']),
  origemInternacao: numOuNull(x['origem_internacao_id']),
  orcamento: numOuNull(x['orcamento_internacao_domiciliar_id']),
  orcamentoNumero: txtOuNull(x['orcamento_numero']),
  medico: numOuNull(x['medico_responsavel_profissional_id']),
  medicoNome: txtOuNull(x['medico_nome']),
  porLiminar: bool(x['por_liminar_judicial']),
  solicitacao: txtOuNull(x['solicitacao_txt']),
  prevista: txtOuNull(x['prevista_txt']),
  inicio: iso(x['data_hora_inicio']),
  fim: iso(x['data_hora_fim']),
  observacao: txtOuNull(x['observacao']),
});
export type InternacaoDomiciliarLida = ReturnType<typeof internacaoLida>;

const chamadoLido = (x: Record<string, unknown>) => ({
  id: num(x['id']),
  versao: num(x['versao']),
  numero: String(x['numero']),
  paciente: num(x['paciente_id']),
  pacienteNome: txtOuNull(x['paciente_nome']),
  internacao: numOuNull(x['internacao_domiciliar_id']),
  tipo: num(x['tipo_chamado_domiciliar_id']),
  tipoNome: txtOuNull(x['tipo_nome']),
  motivoNome: txtOuNull(x['motivo_nome']),
  prioridade: txtOuNull(x['prioridade']),
  situacao: String(x['situacao']),
  chamadoEm: iso(x['chamado_em'])!,
  endereco: [x['logradouro'], x['numero_endereco'], x['bairro']].filter(Boolean).join(', ') || null,
  sintoma: txtOuNull(x['sintoma_relatado']),
  profissional: numOuNull(x['atribuido_profissional_id']),
  profissionalNome: txtOuNull(x['prof_nome']),
  desfecho: txtOuNull(x['desfecho']),
  realizadoEm: iso(x['realizado_em']),
  motivoAnulacao: txtOuNull(x['motivo_anulacao']),
});
export type ChamadoDomiciliarLido = ReturnType<typeof chamadoLido>;

const visitaLida = (x: Record<string, unknown>) => ({
  id: num(x['id']),
  versao: num(x['versao']),
  paciente: num(x['paciente_id']),
  pacienteNome: txtOuNull(x['paciente_nome']),
  internacao: numOuNull(x['internacao_domiciliar_id']),
  chamado: numOuNull(x['chamado_domiciliar_id']),
  profissional: num(x['profissional_id']),
  profissionalNome: txtOuNull(x['prof_nome']),
  tipoNome: txtOuNull(x['tipo_nome']),
  agendadaPara: iso(x['agendada_para'])!,
  duracao: numOuNull(x['duracao_prevista_minutos']),
  extra: bool(x['extra']),
  situacao: String(x['situacao']),
  iniciadaEm: iso(x['iniciada_em']),
  encerradaEm: iso(x['encerrada_em']),
  motivo: txtOuNull(x['motivo_nao_realizacao']),
});
export type VisitaDomiciliarLida = ReturnType<typeof visitaLida>;

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}
const recusa = (titulo: string, problemas: readonly { campo: string; mensagem: string }[]) => {
  if (problemas.length) throw recusaRegra(titulo, problemas);
};
/** Acrescenta uma linha datada à observação, sem apagar o que havia. */
const comNota = (obs: unknown, dia: string, rotulo: string, motivo: string | null) =>
  motivo ? [txtOuNull(obs), `[${dia} ${rotulo}] ${motivo}`].filter(Boolean).join('\n') : txtOuNull(obs);

export class PortaInternacaoDomiciliarPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.domiciliar');
  }

  /** Cadastros das escolhas da tela (só os ativos). */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l, est) => {
      const lista = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        tiposChamado: (
          await l.consultar(
            'SELECT id, descricao, coparticipacao FROM tipo_chamado_domiciliar WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: String(x['descricao']),
          coparticipacao: bool(x['coparticipacao']),
        })),
        motivosChamado: (
          await l.consultar(
            'SELECT id, descricao, tipo_chamado_domiciliar_id FROM motivo_chamado_domiciliar WHERE ativo = TRUE ORDER BY descricao LIMIT 300',
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: String(x['descricao']),
          tipo: numOuNull(x['tipo_chamado_domiciliar_id']),
        })),
        motivosTransferencia: await lista(
          'SELECT id, descricao AS nome FROM motivo_transferencia_domicilio WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
        ),
        programas: await lista(
          'SELECT id, descricao AS nome FROM programa_atencao_domiciliar WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
        ),
        areas: await lista(
          `SELECT id, descricao AS nome FROM area_atendimento_domiciliar WHERE estabelecimento_id = ? AND ativo = TRUE
            ORDER BY descricao LIMIT 200`,
          [est.id],
        ),
        fontes: await lista('SELECT id, nome FROM fonte_pagadora ORDER BY nome LIMIT 500'),
        tiposCusto: await lista(
          'SELECT id, descricao AS nome FROM tipo_custo WHERE ativo = TRUE ORDER BY descricao LIMIT 300',
        ),
        profissionais: await lista(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.excluido_em IS NULL ORDER BY nome LIMIT 1000`,
        ),
      };
    });
  }

  /** Painel: internações abertas, fila dos chamados, visitas da semana e orçamentos à espera. */
  painel(c: ContextoPortaPropria) {
    return this.ler(c, 'painel', async (l, est) => {
      const internacoes = (
        await l.consultar(
          `${SELECT_INTERNACAO} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
             AND x.situacao IN ('solicitada', 'em_avaliacao', 'ativa', 'suspensa') ORDER BY x.data_solicitacao, x.id LIMIT 500`,
          [est.id],
        )
      ).map(internacaoLida);
      const chamados = ordenarFilaChamadosDomiciliares(
        (
          await l.consultar(
            `${SELECT_CHAMADO} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
               AND x.situacao IN ('aberto', 'triado', 'atribuido', 'em_atendimento') LIMIT 500`,
            [est.id],
          )
        ).map(chamadoLido),
      );
      const visitas = (
        await l.consultar(
          `${SELECT_VISITA} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
             AND (x.situacao = 'em_andamento' OR (x.situacao IN ('agendada', 'confirmada')
                  AND x.agendada_para < NOW(3) + INTERVAL 7 DAY))
           ORDER BY x.agendada_para LIMIT 500`,
          [est.id],
        )
      ).map(visitaLida);
      const orcamentos = (
        await l.consultar(
          `${SELECT_ORCAMENTO} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
             AND x.situacao IN ('rascunho', 'enviado') ORDER BY x.data_hora_orcamento LIMIT 500`,
          [est.id],
        )
      ).map((x) => orcamentoLido(x, []));
      return { internacoes, chamados, visitas, orcamentos };
    });
  }

  /** Visão do paciente: endereços, internações hospitalares abertas, orçamentos, internações domiciliares, chamados e visitas. */
  paciente(c: ContextoPortaPropria, pacienteId: number) {
    return this.ler(c, 'paciente', async (l, est) => {
      const p = await exigir(
        l,
        `SELECT p.id, p.pessoa_fisica_id, COALESCE(p.nome_social, pf.nome) AS nome FROM paciente p
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ? AND p.excluido_em IS NULL`,
        [pacienteId],
        'Paciente',
      );
      const enderecos = (
        await l.consultar(
          `SELECT id, CONCAT_WS(', ', logradouro, numero, bairro_nome, cep) AS nome FROM endereco_pessoa
            WHERE pessoa_fisica_id = ? AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
            ORDER BY principal DESC, sequencia LIMIT 50`,
          [p['pessoa_fisica_id'] ?? 0],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      const hospitalares = (
        await l.consultar(
          `SELECT i.id, CONCAT(i.numero, ' · ', DATE_FORMAT(i.data_hora_entrada, '%d/%m/%Y')) AS nome FROM internacao i
            WHERE i.paciente_id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.data_hora_alta IS NULL
            ORDER BY i.id DESC LIMIT 20`,
          [pacienteId, est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      const orcs = await l.consultar(
        `${SELECT_ORCAMENTO} WHERE x.paciente_id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
          ORDER BY x.id DESC LIMIT 100`,
        [pacienteId, est.id],
      );
      const ids = orcs.map((x) => num(x['id']));
      const itens = ids.length
        ? await l.consultar(
            `SELECT * FROM orcamento_internacao_domiciliar_item WHERE excluido_em IS NULL
               AND orcamento_internacao_domiciliar_id IN (${ids.map(() => '?').join(',')}) ORDER BY sequencia`,
            ids,
          )
        : [];
      const filtro = 'WHERE x.paciente_id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL';
      return {
        paciente: { id: num(p['id']), nome: txtOuNull(p['nome']) },
        enderecos,
        hospitalares,
        orcamentos: orcs.map((x) => orcamentoLido(x, itens)),
        internacoes: (
          await l.consultar(`${SELECT_INTERNACAO} ${filtro} ORDER BY x.id DESC LIMIT 100`, [
            pacienteId,
            est.id,
          ])
        ).map(internacaoLida),
        chamados: (
          await l.consultar(`${SELECT_CHAMADO} ${filtro} ORDER BY x.chamado_em DESC LIMIT 200`, [
            pacienteId,
            est.id,
          ])
        ).map(chamadoLido),
        visitas: (
          await l.consultar(`${SELECT_VISITA} ${filtro} ORDER BY x.agendada_para DESC LIMIT 300`, [
            pacienteId,
            est.id,
          ])
        ).map(visitaLida),
      };
    });
  }

  private async numero(tx: TxOperacao, est: number, tipo: string): Promise<string> {
    const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      tipo,
      est,
    ]);
    if (!seq)
      await tx.incluir(T_SEQUENCIA, {
        estabelecimento_id: est,
        tipo,
        prefixo: NUMERACAO[tipo],
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return (await tx.proximoNumero(tipo)).formatado;
  }

  // ------------------------------------------------------------ orçamento
  /** Cria o orçamento (rascunho) ou, com `alvo`, troca o cabeçalho e os itens do rascunho. */
  salvarOrcamento(c: ContextoPortaPropria, alvo: number | null, entrada: unknown) {
    const e = entradaValida(esquemaOrcamento, entrada);
    const nome =
      alvo === null ? 'internacao.domiciliar.orcamento.criar' : 'internacao.domiciliar.orcamento.alterar';
    return this.gravar(c, nome, TABELAS, async (tx, est, usuario) => {
      const agora = new Date();
      await exigir(
        tx,
        'SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [e.paciente],
        'Paciente',
      );
      if (e.fontePagadora !== null)
        await exigir(tx, 'SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora], 'Fonte pagadora');
      const itens = [];
      for (const i of e.itens) {
        const item = i.itemCodigo
          ? num(
              (
                await exigir(
                  tx,
                  'SELECT id FROM item_faturavel WHERE codigo = ?',
                  [i.itemCodigo],
                  `Item ${i.itemCodigo}`,
                )
              )['id'],
            )
          : null;
        if (i.tipoCusto !== null)
          await exigir(
            tx,
            'SELECT id FROM tipo_custo WHERE id = ? AND ativo = TRUE',
            [i.tipoCusto],
            'Tipo de custo',
          );
        itens.push({ ...i, itemFaturavel: item });
      }
      recusa(
        'Orçamento recusado',
        conferirOrcamentoDomiciliar({
          tipo: e.tipo,
          fontePagadora: e.fontePagadora,
          periodoInicio: e.periodoInicio,
          periodoFim: e.periodoFim,
          validade: e.validade,
          percentualImpostos: e.percentualImpostos,
          itens,
          hoje: diaNoFuso(agora, est.fuso),
        }),
      );
      const t = totaisOrcamentoDomiciliar(itens, e.percentualImpostos);
      const cabecalho = {
        paciente_id: e.paciente,
        programa_atencao_domiciliar_id: e.programa,
        tipo_orcamento: e.tipo,
        modalidade_atendimento: e.modalidade,
        fonte_pagadora_id: e.fontePagadora,
        plano_fonte_pagadora_id: e.plano,
        numero_carteira: e.carteira,
        data_validade: e.validade,
        periodo_inicio: e.periodoInicio,
        periodo_fim: e.periodoFim,
        solicitante_profissional_id: e.solicitante,
        solicitante_externo: e.solicitanteExterno,
        diagnostico: e.diagnostico,
        avaliacao_admissional: e.avaliacao,
        proposta_terapeutica: e.proposta,
        observacao: e.observacao,
        valor_custo_total: t.valorCustoTotal,
        percentual_impostos: e.percentualImpostos,
        valor_impostos: t.valorImpostos,
        valor_total: t.valorTotal,
      };
      let orcId: number;
      let numero: string;
      let seq = 0;
      if (alvo === null) {
        numero = await this.numero(tx, est.id, T_ORCAMENTO);
        orcId = await tx.incluir(T_ORCAMENTO, {
          ...cabecalho,
          estabelecimento_id: est.id,
          numero,
          data_hora_orcamento: agora,
          situacao: 'rascunho',
        });
      } else {
        const [o] = await tx.consultarParaAtualizar(
          `SELECT id, numero, situacao, paciente_id FROM orcamento_internacao_domiciliar
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [alvo, est.id],
          { teto: 1 },
        );
        if (!o) throw naoEncontrado('Orçamento');
        const r = conferirAcaoOrcamento({
          acao: 'editar',
          situacao: String(o['situacao']),
          itens: e.itens.length,
          validade: e.validade,
          hoje: diaNoFuso(agora, est.fuso),
        });
        recusa('Orçamento recusado', r.problemas);
        if (num(o['paciente_id']) !== e.paciente)
          recusa('Orçamento recusado', [{ campo: 'paciente', mensagem: 'O orçamento é de outro paciente.' }]);
        if (e.versao === undefined)
          recusa('Orçamento recusado', [
            { campo: 'versao', mensagem: 'Informe a versão lida do orçamento.' },
          ]);
        orcId = alvo;
        numero = String(o['numero']);
        await tx.alterar(T_ORCAMENTO, alvo, e.versao!, cabecalho);
        const antigos = await tx.consultar(
          'SELECT id, versao, sequencia FROM orcamento_internacao_domiciliar_item WHERE orcamento_internacao_domiciliar_id = ?',
          [alvo],
        );
        seq = antigos.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
        // Os itens antigos ficam no banco, marcados como excluídos; os novos seguem a sequência.
        const ativos = await tx.consultar(
          `SELECT id, versao FROM orcamento_internacao_domiciliar_item
            WHERE orcamento_internacao_domiciliar_id = ? AND excluido_em IS NULL`,
          [alvo],
        );
        for (const x of ativos)
          await tx.alterar(T_ITEM, num(x['id']), num(x['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
      }
      for (const i of itens) {
        const v = valorItemOrcamento(i);
        await tx.incluir(T_ITEM, {
          orcamento_internacao_domiciliar_id: orcId,
          sequencia: ++seq,
          tipo_item: i.tipoItem,
          item_faturavel_id: i.itemFaturavel,
          tipo_custo_id: i.tipoCusto,
          descricao: i.descricao,
          quantidade: i.quantidade,
          quantidade_dias: i.dias,
          valor_custo_unitario: i.valorCustoUnitario,
          valor_unitario: i.valorUnitario,
          percentual_acrescimo: i.percentualAcrescimo,
          valor_total: v.valorTotal,
        });
      }
      return { tabela: T_ORCAMENTO, id: orcId, numero, valorTotal: t.valorTotal };
    });
  }

  acaoOrcamento(
    c: ContextoPortaPropria,
    alvo: number,
    acao: Exclude<AcaoOrcamentoDomiciliar, 'editar'>,
    entrada: unknown,
  ) {
    const x = entradaValida(z.object({ versao }).strict(), entrada);
    return this.gravar(c, `internacao.domiciliar.orcamento.${acao}`, TABELAS, async (tx, est) => {
      const agora = new Date();
      const [o] = await tx.consultarParaAtualizar(
        `SELECT situacao, DATE_FORMAT(data_validade, '%Y-%m-%d') AS validade,
                (SELECT COUNT(*) FROM orcamento_internacao_domiciliar_item i
                  WHERE i.orcamento_internacao_domiciliar_id = o.id AND i.excluido_em IS NULL) AS itens
           FROM orcamento_internacao_domiciliar o WHERE o.id = ? AND o.estabelecimento_id = ? AND o.excluido_em IS NULL`,
        [alvo, est.id],
        { teto: 1 },
      );
      if (!o) throw naoEncontrado('Orçamento');
      const r = conferirAcaoOrcamento({
        acao,
        situacao: String(o['situacao']),
        itens: num(o['itens']),
        validade: txtOuNull(o['validade']),
        hoje: diaNoFuso(agora, est.fuso),
      });
      recusa('Orçamento recusado', r.problemas);
      const resposta = acao === 'aprovar' || acao === 'recusar' ? { data_hora_resposta: agora } : {};
      await tx.alterar(T_ORCAMENTO, alvo, x.versao, { situacao: r.situacao, ...resposta });
      return { tabela: T_ORCAMENTO, id: alvo, situacao: r.situacao! };
    });
  }

  // ------------------------------------------------------------ transferência e ciclo
  transferir(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaTransferir, entrada);
    return this.gravar(c, 'internacao.domiciliar.transferir', TABELAS, async (tx, est) => {
      const agora = new Date();
      const hoje = diaNoFuso(agora, est.fuso);
      const p = await exigir(
        tx,
        'SELECT id, pessoa_fisica_id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [e.paciente],
        'Paciente',
      );
      const end = await exigir(
        tx,
        'SELECT id, pessoa_fisica_id FROM endereco_pessoa WHERE id = ? AND excluido_em IS NULL',
        [e.endereco],
        'Endereço',
      );
      const origem =
        e.origemInternacao === null
          ? null
          : await exigir(
              tx,
              'SELECT id, paciente_id, data_hora_alta FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [e.origemInternacao, est.id],
              'Internação de origem',
            );
      const orc =
        e.orcamento === null
          ? null
          : await exigir(
              tx,
              `SELECT id, paciente_id, situacao, fonte_pagadora_id, plano_fonte_pagadora_id, programa_atencao_domiciliar_id
                 FROM orcamento_internacao_domiciliar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [e.orcamento, est.id],
              'Orçamento',
            );
      const aberta = await tx.uma(
        `SELECT id FROM internacao_domiciliar WHERE paciente_id = ? AND excluido_em IS NULL
            AND situacao IN ('solicitada', 'em_avaliacao', 'ativa', 'suspensa') LIMIT 1`,
        [e.paciente],
      );
      const liminar = e.liminarNumero !== null || e.liminarData !== null;
      recusa(
        'Transferência para casa recusada',
        conferirTransferenciaDomicilio({
          paciente: e.paciente,
          enderecoDoPaciente:
            end['pessoa_fisica_id'] !== null && num(end['pessoa_fisica_id']) === num(p['pessoa_fisica_id']),
          origem: origem
            ? { paciente: num(origem['paciente_id']), aberta: origem['data_hora_alta'] === null }
            : null,
          orcamento: orc ? { paciente: num(orc['paciente_id']), situacao: String(orc['situacao']) } : null,
          liminar: liminar ? { numero: e.liminarNumero, data: e.liminarData } : null,
          dataPrevista: e.dataPrevista,
          outraAberta: !!aberta,
          hoje,
        }),
      );
      const numero = await this.numero(tx, est.id, T_INTERNACAO);
      const novo = await tx.incluir(T_INTERNACAO, {
        estabelecimento_id: est.id,
        numero,
        paciente_id: e.paciente,
        origem_internacao_id: e.origemInternacao,
        programa_atencao_domiciliar_id: e.programa ?? numOuNull(orc?.['programa_atencao_domiciliar_id']),
        area_atendimento_domiciliar_id: e.area,
        endereco_pessoa_id: e.endereco,
        motivo_transferencia_domicilio_id: e.motivo,
        fonte_pagadora_id: numOuNull(orc?.['fonte_pagadora_id']),
        plano_fonte_pagadora_id: numOuNull(orc?.['plano_fonte_pagadora_id']),
        orcamento_internacao_domiciliar_id: e.orcamento,
        medico_responsavel_profissional_id: e.medico,
        enfermeiro_supervisor_profissional_id: e.enfermeiro,
        tecnico_enfermagem_profissional_id: e.tecnico,
        data_solicitacao: hoje,
        data_prevista_inicio: e.dataPrevista,
        por_liminar_judicial: liminar,
        numero_liminar: e.liminarNumero,
        data_liminar: e.liminarData,
        situacao: 'solicitada',
        observacao: e.observacao,
      });
      return { tabela: T_INTERNACAO, id: novo, numero };
    });
  }

  acaoInternacao(c: ContextoPortaPropria, alvo: number, acao: AcaoInternacaoDomiciliar, entrada: unknown) {
    const x = entradaValida(esquemaAcaoInternacao, entrada);
    return this.gravar(c, `internacao.domiciliar.${acao}`, TABELAS, async (tx, est) => {
      const agora = new Date();
      const [d] = await tx.consultarParaAtualizar(
        'SELECT * FROM internacao_domiciliar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [alvo, est.id],
        { teto: 1 },
      );
      if (!d) throw naoEncontrado('Internação domiciliar');
      const contar = async (sql: string) => num((await tx.uma(sql, [alvo]))?.['n']);
      const momento = x.quando ?? agora;
      const r = conferirAcaoInternacaoDomiciliar({
        acao,
        situacao: String(d['situacao']),
        medicoResponsavel: (x.medico ?? numOuNull(d['medico_responsavel_profissional_id'])) !== null,
        inicio: d['data_hora_inicio'] ? new Date(String(iso(d['data_hora_inicio']))) : null,
        quando: momento,
        agora,
        motivo: x.motivo,
        chamadosAbertos:
          acao === 'encerrar'
            ? await contar(
                `SELECT COUNT(*) AS n FROM chamado_domiciliar WHERE internacao_domiciliar_id = ? AND excluido_em IS NULL
                   AND situacao IN ('aberto', 'triado', 'atribuido', 'em_atendimento')`,
              )
            : 0,
        visitasEmAndamento:
          acao === 'encerrar'
            ? await contar(
                `SELECT COUNT(*) AS n FROM visita_domiciliar WHERE internacao_domiciliar_id = ? AND excluido_em IS NULL
                   AND situacao = 'em_andamento'`,
              )
            : 0,
      });
      recusa('Internação domiciliar recusada', r.problemas);
      const rotulo: Record<AcaoInternacaoDomiciliar, string> = {
        avaliar: 'avaliação',
        iniciar: 'início',
        suspender: 'suspensão',
        retomar: 'retomada',
        encerrar: 'encerramento',
        cancelar: 'cancelamento',
      };
      const equipe = {
        ...(x.medico !== null ? { medico_responsavel_profissional_id: x.medico } : {}),
        ...(x.enfermeiro !== null ? { enfermeiro_supervisor_profissional_id: x.enfermeiro } : {}),
        ...(x.tecnico !== null ? { tecnico_enfermagem_profissional_id: x.tecnico } : {}),
      };
      await tx.alterar(T_INTERNACAO, alvo, x.versao, {
        ...equipe,
        situacao: r.situacao,
        ...(acao === 'iniciar' ? { data_hora_inicio: momento } : {}),
        ...(acao === 'encerrar' ? { data_hora_fim: momento } : {}),
        observacao: comNota(d['observacao'], diaNoFuso(momento, est.fuso), rotulo[acao], x.motivo),
      });
      let visitasCanceladas = 0;
      if (acao === 'encerrar' || acao === 'cancelar') {
        const pendentes = await tx.consultar(
          `SELECT id, versao FROM visita_domiciliar WHERE internacao_domiciliar_id = ? AND excluido_em IS NULL
             AND situacao IN ('agendada', 'confirmada')`,
          [alvo],
        );
        for (const v of pendentes)
          await tx.alterar(T_VISITA, num(v['id']), num(v['versao']), {
            situacao: 'cancelada',
            motivo_nao_realizacao: `Internação domiciliar ${acao === 'encerrar' ? 'encerrada' : 'cancelada'}.`,
          });
        visitasCanceladas = pendentes.length;
      }
      return { tabela: T_INTERNACAO, id: alvo, situacao: r.situacao!, visitasCanceladas };
    });
  }

  // ------------------------------------------------------------ chamados
  abrirChamado(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaChamado, entrada);
    return this.gravar(c, 'internacao.domiciliar.chamado.abrir', TABELAS, async (tx, est) => {
      const agora = new Date();
      await exigir(
        tx,
        'SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [e.paciente],
        'Paciente',
      );
      const tipo = await tx.uma('SELECT id, ativo FROM tipo_chamado_domiciliar WHERE id = ?', [e.tipo]);
      if (!tipo) throw naoEncontrado('Tipo de chamado');
      const motivo =
        e.motivo === null
          ? null
          : await exigir(
              tx,
              'SELECT id, tipo_chamado_domiciliar_id FROM motivo_chamado_domiciliar WHERE id = ? AND ativo = TRUE',
              [e.motivo],
              'Motivo do chamado',
            );
      const dom = await tx.uma(
        `SELECT d.id, d.situacao, d.area_atendimento_domiciliar_id, d.fonte_pagadora_id, d.plano_fonte_pagadora_id,
                en.cep, en.logradouro, en.numero, en.complemento, en.bairro_nome, en.municipio_ibge_id
           FROM internacao_domiciliar d JOIN endereco_pessoa en ON en.id = d.endereco_pessoa_id
          WHERE d.paciente_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL
            AND d.situacao IN ('solicitada', 'em_avaliacao', 'ativa', 'suspensa')
          ORDER BY d.id DESC LIMIT 1`,
        [e.paciente, est.id],
      );
      const chamadoEm = e.chamadoEm ?? agora;
      recusa(
        'Chamado domiciliar recusado',
        conferirChamadoDomiciliar({
          tipoAtivo: bool(tipo['ativo']),
          motivoDeOutroTipo:
            !!motivo &&
            motivo['tipo_chamado_domiciliar_id'] !== null &&
            num(motivo['tipo_chamado_domiciliar_id']) !== e.tipo,
          internacaoSituacao: dom ? String(dom['situacao']) : null,
          temEndereco: e.logradouro !== null || !!dom,
          prioridade: e.prioridade,
          chamadoEm,
          agora,
        }),
      );
      const doEndereco = e.logradouro === null && dom;
      const numero = await this.numero(tx, est.id, T_CHAMADO);
      const novo = await tx.incluir(T_CHAMADO, {
        estabelecimento_id: est.id,
        numero,
        paciente_id: e.paciente,
        chamado_em: chamadoEm,
        tipo_chamado_domiciliar_id: e.tipo,
        motivo_chamado_domiciliar_id: e.motivo,
        area_atendimento_domiciliar_id: numOuNull(dom?.['area_atendimento_domiciliar_id']),
        internacao_domiciliar_id: numOuNull(dom?.['id']),
        fonte_pagadora_id: numOuNull(dom?.['fonte_pagadora_id']),
        plano_fonte_pagadora_id: numOuNull(dom?.['plano_fonte_pagadora_id']),
        cep: doEndereco ? txtOuNull(dom['cep']) : e.cep,
        logradouro: doEndereco ? txtOuNull(dom['logradouro']) : e.logradouro,
        numero_endereco: doEndereco ? txtOuNull(dom['numero']) : e.numero,
        complemento: doEndereco ? (txtOuNull(dom['complemento'])?.slice(0, 60) ?? null) : e.complemento,
        bairro: doEndereco ? txtOuNull(dom['bairro_nome']) : e.bairro,
        municipio_ibge_id: doEndereco ? numOuNull(dom['municipio_ibge_id']) : null,
        telefone: e.telefone,
        sintoma_relatado: e.sintoma,
        prioridade: e.prioridade,
        situacao: e.prioridade ? 'triado' : 'aberto',
        observacao: e.observacao,
      });
      return { tabela: T_CHAMADO, id: novo, numero, internacao: numOuNull(dom?.['id']) };
    });
  }

  acaoChamado(
    c: ContextoPortaPropria,
    alvo: number,
    acao: Exclude<AcaoChamadoDomiciliar, 'iniciar'>,
    entrada: unknown,
  ) {
    const x = entradaValida(esquemaAcaoChamado, entrada);
    return this.gravar(c, `internacao.domiciliar.chamado.${acao}`, TABELAS, async (tx, est, usuario) => {
      const agora = new Date();
      const [ch] = await tx.consultarParaAtualizar(
        `SELECT c.*, t.coparticipacao FROM chamado_domiciliar c
           JOIN tipo_chamado_domiciliar t ON t.id = c.tipo_chamado_domiciliar_id
          WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
        [alvo, est.id],
        { teto: 1 },
      );
      if (!ch) throw naoEncontrado('Chamado domiciliar');
      const visitas = await tx.consultar(
        'SELECT id, versao, situacao FROM visita_domiciliar WHERE chamado_domiciliar_id = ? AND excluido_em IS NULL',
        [alvo],
      );
      if (acao === 'atribuir' && x.profissional !== null)
        await exigir(
          tx,
          'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
          [x.profissional],
          'Profissional',
        );
      const r = conferirAcaoChamadoDomiciliar({
        acao,
        situacao: String(ch['situacao']),
        prioridade: x.prioridade,
        profissional: x.profissional,
        desfecho: x.desfecho,
        visitaRealizada: visitas.some((v) => v['situacao'] === 'realizada'),
        tipoComCoparticipacao: bool(ch['coparticipacao']),
        coparticipacao: x.coparticipacao,
        motivo: x.motivo,
      });
      recusa('Chamado domiciliar recusado', r.problemas);
      let visita: number | null = null;
      if (acao === 'atribuir') {
        const quandoVisita = x.agendadaPara ?? agora;
        const outras = await tx.consultar(
          `SELECT agendada_para, duracao_prevista_minutos FROM visita_domiciliar
            WHERE profissional_id = ? AND excluido_em IS NULL AND situacao IN ('agendada', 'confirmada', 'em_andamento')
              AND agendada_para BETWEEN ? - INTERVAL 1 DAY AND ? + INTERVAL 1 DAY`,
          [x.profissional, quandoVisita, quandoVisita],
        );
        // A visita do chamado é extra: na internação suspensa também se atende a intercorrência.
        recusa(
          'Chamado domiciliar recusado',
          conferirVisitaDomiciliar({
            internacaoSituacao: null,
            inicioInternacao: null,
            quando: quandoVisita,
            duracaoMinutos: null,
            outrasDoProfissional: outras.map((o) => ({
              quando: new Date(String(iso(o['agendada_para']))),
              duracaoMinutos: numOuNull(o['duracao_prevista_minutos']),
            })),
          }),
        );
        visita = await tx.incluir(T_VISITA, {
          estabelecimento_id: est.id,
          paciente_id: ch['paciente_id'],
          internacao_domiciliar_id: ch['internacao_domiciliar_id'],
          profissional_id: x.profissional,
          tipo_chamado_domiciliar_id: ch['tipo_chamado_domiciliar_id'],
          chamado_domiciliar_id: alvo,
          agendada_para: quandoVisita,
          extra: true,
          situacao: 'agendada',
        });
      }
      if (acao === 'anular')
        for (const v of visitas.filter((v) => ['agendada', 'confirmada'].includes(String(v['situacao']))))
          await tx.alterar(T_VISITA, num(v['id']), num(v['versao']), {
            situacao: 'cancelada',
            motivo_nao_realizacao: 'Chamado anulado.',
          });
      const campos: Record<string, unknown> = { situacao: r.situacao };
      if (acao === 'triar') campos['prioridade'] = x.prioridade;
      if (acao === 'atribuir')
        Object.assign(campos, { atribuido_profissional_id: x.profissional, atribuido_em: agora });
      if (acao === 'concluir')
        Object.assign(campos, {
          desfecho: x.desfecho,
          realizado_em: agora,
          valor_coparticipacao: x.coparticipacao,
        });
      if (acao === 'anular')
        Object.assign(campos, {
          anulado_em: agora,
          anulado_por_usuario_id: usuario,
          motivo_anulacao: x.motivo,
        });
      await tx.alterar(T_CHAMADO, alvo, x.versao, campos);
      return { tabela: T_CHAMADO, id: alvo, situacao: r.situacao!, visita };
    });
  }

  // ------------------------------------------------------------ visitas
  agendarVisita(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaVisita, entrada);
    return this.gravar(c, 'internacao.domiciliar.visita.agendar', TABELAS, async (tx, est) => {
      const d = await exigir(
        tx,
        `SELECT id, paciente_id, situacao, data_hora_inicio FROM internacao_domiciliar
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.internacao, est.id],
        'Internação domiciliar',
      );
      await exigir(
        tx,
        'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
        [e.profissional],
        'Profissional',
      );
      await exigir(
        tx,
        'SELECT id FROM tipo_chamado_domiciliar WHERE id = ? AND ativo = TRUE',
        [e.tipo],
        'Tipo de visita',
      );
      const outras = await tx.consultar(
        `SELECT agendada_para, duracao_prevista_minutos FROM visita_domiciliar
          WHERE profissional_id = ? AND excluido_em IS NULL AND situacao IN ('agendada', 'confirmada', 'em_andamento')
            AND agendada_para BETWEEN ? - INTERVAL 1 DAY AND ? + INTERVAL 1 DAY`,
        [e.profissional, e.quando, e.quando],
      );
      recusa(
        'Visita recusada',
        conferirVisitaDomiciliar({
          internacaoSituacao: String(d['situacao']),
          inicioInternacao: d['data_hora_inicio'] ? new Date(String(iso(d['data_hora_inicio']))) : null,
          quando: e.quando,
          duracaoMinutos: e.duracao,
          outrasDoProfissional: outras.map((o) => ({
            quando: new Date(String(iso(o['agendada_para']))),
            duracaoMinutos: numOuNull(o['duracao_prevista_minutos']),
          })),
        }),
      );
      const novo = await tx.incluir(T_VISITA, {
        estabelecimento_id: est.id,
        paciente_id: d['paciente_id'],
        internacao_domiciliar_id: e.internacao,
        profissional_id: e.profissional,
        tipo_chamado_domiciliar_id: e.tipo,
        agendada_para: e.quando,
        duracao_prevista_minutos: e.duracao,
        extra: false,
        situacao: 'agendada',
        observacao: e.observacao,
      });
      return { tabela: T_VISITA, id: novo };
    });
  }

  acaoVisita(c: ContextoPortaPropria, alvo: number, acao: AcaoVisitaDomiciliar, entrada: unknown) {
    const x = entradaValida(esquemaAcaoVisita, entrada);
    return this.gravar(c, `internacao.domiciliar.visita.${acao}`, TABELAS, async (tx, est) => {
      const agora = new Date();
      const [v] = await tx.consultarParaAtualizar(
        'SELECT * FROM visita_domiciliar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [alvo, est.id],
        { teto: 1 },
      );
      if (!v) throw naoEncontrado('Visita domiciliar');
      const iniciada = v['iniciada_em'] ? new Date(String(iso(v['iniciada_em']))) : null;
      const inicio = x.inicio ?? iniciada ?? (acao === 'iniciar' ? agora : null);
      const fim = x.fim ?? (acao === 'realizar' ? agora : null);
      const r = conferirAcaoVisitaDomiciliar({
        acao,
        situacao: String(v['situacao']),
        inicio,
        fim,
        agora,
        motivo: x.motivo,
      });
      recusa('Visita recusada', r.problemas);
      const campos: Record<string, unknown> = { situacao: r.situacao };
      if (acao === 'iniciar') campos['iniciada_em'] = inicio;
      if (acao === 'realizar') Object.assign(campos, { iniciada_em: inicio, encerrada_em: fim });
      if (acao === 'cancelar' || acao === 'nao_realizar') campos['motivo_nao_realizacao'] = x.motivo;
      await tx.alterar(T_VISITA, alvo, x.versao, campos);
      // A visita do chamado iniciada (ou registrada como feita) põe o chamado em atendimento.
      if ((acao === 'iniciar' || acao === 'realizar') && v['chamado_domiciliar_id']) {
        const ch = await tx.uma('SELECT id, versao, situacao FROM chamado_domiciliar WHERE id = ?', [
          v['chamado_domiciliar_id'],
        ]);
        if (
          ch &&
          conferirAcaoChamadoDomiciliar({ acao: 'iniciar', situacao: String(ch['situacao']) }).situacao
        )
          await tx.alterar(T_CHAMADO, num(ch['id']), num(ch['versao']), { situacao: 'em_atendimento' });
      }
      return { tabela: T_VISITA, id: alvo, situacao: r.situacao! };
    });
  }
}
