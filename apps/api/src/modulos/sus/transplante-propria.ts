// Transplante para a central estadual (F8, 06-SUS linha 65), no banco do cliente: notificação de potencial doador e
// inscrição de receptor com histórico. As regras são as puras de @sgh/dominio-faturamento (sus/transplante.ts); aqui
// ficam a leitura e a gravação. Contrato de efeito:
//   - notificar: uma linha em `notificacao_doador` do estabelecimento, número pela sequencia_negocio
//     "notificacao_doador" (criada na primeira vez, prefixo ND-), situação notificada (ou a informada, se coerente);
//   - alterar a notificação: protocolo de morte encefálica, abordagem familiar, consentimento, órgãos doados, desfecho e
//     situação, com a versão lida (a situação só avança; encerrada e cancelada não mudam mais);
//   - protocolo da central: `protocolo_central` digitado de volta, com a versão lida;
//   - inscrever: uma linha em `inscricao_transplante` (receptor; número da central opcional) e a linha "inclusao" em
//     `inscricao_transplante_historico` (dados do momento, pendente de envio);
//   - alterar a inscrição: os campos com a versão lida e a linha "alteracao" (ou "exclusao", quando a inscrição sai da
//     lista: transplantado, removida, óbito) no histórico; nada apagado;
//   - registro da central: o número da inscrição devolvido pela central e o envio das linhas pendentes do histórico
//     (`enviado_central_em`), com a versão lida.
// A trilha de cada gravação vai pelo executor (mesma transação). Leituras só do estabelecimento da sessão.
import {
  conferirInscricao,
  conferirNotificacaoDoador,
  conferirTransicaoNotificacao,
  csvConferenciaInscricoes,
  DESFECHOS_DOACAO,
  type DadosInscricao,
  type DadosNotificacaoDoador,
  PRIORIDADES_INSCRICAO,
  SITUACOES_INSCRICAO,
  SITUACOES_NOTIFICACAO,
  TIPOS_DOADOR,
  type SituacaoInscricao,
  type SituacaoNotificacao,
} from '@sgh/dominio-faturamento';
import { garantirSequencia } from '@sgh/nucleo';
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
import { dataHora } from '../pep/registro-propria-comum.js';
import { instanteDoLocal } from '../pep/worklist-porta-propria.js';

export const PORTA_TRANSPLANTE = Symbol('PORTA_TRANSPLANTE');

const T_NOTIFICACAO = 'notificacao_doador';
const T_INSCRICAO = 'inscricao_transplante';
const T_HISTORICO = 'inscricao_transplante_historico';
const T_SEQUENCIA = 'sequencia_negocio';
const TABELAS = [T_NOTIFICACAO, T_INSCRICAO, T_HISTORICO, T_SEQUENCIA];
export const SEQUENCIA_NOTIFICACAO_DOADOR = 'notificacao_doador';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const momento = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const texto = (max: number) => z.string().trim().max(max);
const id = z.number().int().positive();

const camposNotificacao = {
  tipoDoador: z.enum(TIPOS_DOADOR),
  notificadoEm: momento,
  notificante: id,
  atendimento: id.nullable().default(null),
  central: id.nullable().default(null),
  obitoEm: momento.nullable().default(null),
  protocoloInicioEm: momento.nullable().default(null),
  protocoloFimEm: momento.nullable().default(null),
  abordagemFamiliarEm: momento.nullable().default(null),
  familiaConsentiu: z.boolean().nullable().default(null),
  orgaosDoados: z.array(texto(30).min(1)).max(20).default([]),
  desfecho: z.enum(DESFECHOS_DOACAO).nullable().default(null),
  desfechoEm: momento.nullable().default(null),
  situacao: z.enum(SITUACOES_NOTIFICACAO).default('notificada'),
  observacao: texto(4000).nullable().default(null),
};
const esquemaNotificacao = z.object({ paciente: id, ...camposNotificacao }).strict();
const esquemaAlteracaoNotificacao = z.object({ ...camposNotificacao, versao: id }).strict();
const esquemaProtocolo = z.object({ protocoloCentral: texto(30).min(1), versao: id }).strict();

const camposInscricao = {
  dataInscricao: dia,
  prioridade: z.enum(PRIORIDADES_INSCRICAO).default('normal'),
  situacao: z.enum(SITUACOES_INSCRICAO).default('ativa'),
  apto: z.boolean().default(true),
  motivo: texto(500).nullable().default(null),
  dataTransplante: dia.nullable().default(null),
  notificacaoDoador: id.nullable().default(null),
  responsavel: id.nullable().default(null),
  numeroCentral: texto(30).nullable().default(null),
};
const esquemaInscricao = z
  .object({
    paciente: id,
    orgao: id,
    tipoPaciente: z.enum(['receptor', 'doador_vivo']).default('receptor'),
    ...camposInscricao,
  })
  .strict();
const esquemaAlteracaoInscricao = z.object({ ...camposInscricao, versao: id }).strict();
const esquemaCentral = z
  .object({
    numeroCentral: texto(30).nullable().default(null),
    marcarEnviado: z.boolean().default(true),
    versao: id,
  })
  .strict();

export interface NotificacaoDoadorLida {
  readonly id: number;
  readonly numero: string;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string;
  readonly tipoDoador: string;
  readonly notificadoEm: string;
  readonly notificante: number;
  readonly notificanteNome: string | null;
  readonly atendimento: number | null;
  readonly central: number | null;
  readonly centralNome: string | null;
  readonly protocoloCentral: string | null;
  readonly obitoEm: string | null;
  readonly protocoloInicioEm: string | null;
  readonly protocoloFimEm: string | null;
  readonly abordagemFamiliarEm: string | null;
  readonly familiaConsentiu: boolean | null;
  readonly orgaosDoados: string[];
  readonly desfecho: string | null;
  readonly desfechoEm: string | null;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly versao: number;
}

export interface HistoricoInscricaoLido {
  readonly id: number;
  readonly operacao: string;
  readonly ocorridoEm: string;
  readonly motivo: string | null;
  readonly enviadoCentralEm: string | null;
}

export interface InscricaoLida {
  readonly id: number;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string;
  readonly cns: string | null;
  readonly orgao: number;
  readonly orgaoDescricao: string;
  readonly tipoPaciente: string;
  readonly numeroCentral: string | null;
  readonly dataInscricao: string;
  readonly prioridade: string;
  readonly situacao: string;
  readonly apto: boolean;
  readonly motivo: string | null;
  readonly dataTransplante: string | null;
  readonly notificacaoDoador: number | null;
  readonly responsavel: number | null;
  /** Linhas do histórico ainda não enviadas à central. */
  readonly pendentesEnvio: number;
  readonly versao: number;
}

export interface OpcoesTransplante {
  readonly orgaos: readonly { id: number; codigo: string; descricao: string; tipo: string }[];
  readonly centrais: readonly { id: number; sigla: string; nome: string }[];
  readonly profissionais: readonly { id: number; nome: string }[];
}

const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const local = (v: unknown, fuso: string): string | null => dataHora(v, fuso)?.slice(0, 16) ?? null;
const listaJson = (v: unknown): string[] => {
  if (v === null || v === undefined) return [];
  const x = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(x) ? x.map(String) : [];
};

const SQL_NOTIFICACAO = `SELECT n.*, pf.nome AS paciente_nome, p.numero_prontuario, pn.nome AS notificante_nome,
       c.sigla AS central_sigla, c.nome AS central_nome
  FROM notificacao_doador n
  JOIN paciente p ON p.id = n.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN profissional pr ON pr.id = n.notificante_profissional_id
  LEFT JOIN pessoa_fisica pn ON pn.id = pr.pessoa_fisica_id
  LEFT JOIN central_reguladora c ON c.id = n.central_reguladora_id
 WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL`;

const SQL_INSCRICAO = `SELECT i.*, pf.nome AS paciente_nome, pf.cns, p.numero_prontuario, o.descricao AS orgao_descricao,
       (SELECT COUNT(*) FROM inscricao_transplante_historico h
         WHERE h.inscricao_transplante_id = i.id AND h.enviado_central_em IS NULL) AS pendentes
  FROM inscricao_transplante i
  JOIN paciente p ON p.id = i.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  JOIN orgao_transplante o ON o.id = i.orgao_transplante_id
 WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL`;

function notificacaoDe(r: Record<string, unknown>, fuso: string): NotificacaoDoadorLida {
  const consentiu = r['familia_consentiu'];
  return {
    id: num(r['id']),
    numero: String(r['numero']),
    paciente: num(r['paciente_id']),
    pacienteNome: String(r['paciente_nome'] ?? ''),
    prontuario: String(r['numero_prontuario'] ?? ''),
    tipoDoador: String(r['tipo_doador']),
    notificadoEm: local(r['notificado_em'], fuso) ?? '',
    notificante: num(r['notificante_profissional_id']),
    notificanteNome: txtOuNull(r['notificante_nome']),
    atendimento: numOuNull(r['atendimento_id']),
    central: numOuNull(r['central_reguladora_id']),
    centralNome: txtOuNull(r['central_sigla']),
    protocoloCentral: txtOuNull(r['protocolo_central']),
    obitoEm: local(r['obito_em'], fuso),
    protocoloInicioEm: local(r['protocolo_morte_encefalica_inicio_em'], fuso),
    protocoloFimEm: local(r['protocolo_morte_encefalica_fim_em'], fuso),
    abordagemFamiliarEm: local(r['abordagem_familiar_em'], fuso),
    familiaConsentiu: consentiu === null || consentiu === undefined ? null : bool(consentiu),
    orgaosDoados: listaJson(r['orgaos_doados']),
    desfecho: txtOuNull(r['desfecho']),
    desfechoEm: local(r['desfecho_em'], fuso),
    situacao: String(r['situacao']),
    observacao: txtOuNull(r['observacao']),
    versao: num(r['versao']),
  };
}

function inscricaoDe(r: Record<string, unknown>): InscricaoLida {
  return {
    id: num(r['id']),
    paciente: num(r['paciente_id']),
    pacienteNome: String(r['paciente_nome'] ?? ''),
    prontuario: String(r['numero_prontuario'] ?? ''),
    cns: txtOuNull(r['cns']),
    orgao: num(r['orgao_transplante_id']),
    orgaoDescricao: String(r['orgao_descricao'] ?? ''),
    tipoPaciente: String(r['tipo_paciente']),
    numeroCentral: txtOuNull(r['numero_inscricao_central']),
    dataInscricao: dataIso(r['data_inscricao'])!,
    prioridade: String(r['prioridade']),
    situacao: String(r['situacao']),
    apto: bool(r['apto']),
    motivo: txtOuNull(r['motivo_aptidao']),
    dataTransplante: dataIso(r['data_transplante']),
    notificacaoDoador: numOuNull(r['notificacao_doador_id']),
    responsavel: numOuNull(r['responsavel_profissional_id']),
    pendentesEnvio: num(r['pendentes']),
    versao: num(r['versao']),
  };
}

type Notif = z.infer<typeof esquemaNotificacao> | z.infer<typeof esquemaAlteracaoNotificacao>;

export class PortaTransplantePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.susTransplante');
  }

  /** Órgãos ativos, centrais de regulação ativas e profissionais do cliente (para os formulários). */
  opcoes(c: ContextoPortaPropria): Promise<OpcoesTransplante> {
    return this.ler(c, 'opcoes', async (l) => ({
      orgaos: (
        await l.consultar(
          'SELECT id, codigo, descricao, tipo FROM orgao_transplante WHERE ativo ORDER BY tipo, descricao LIMIT 200',
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        tipo: String(r['tipo']),
      })),
      centrais: (
        await l.consultar(
          'SELECT id, sigla, nome FROM central_reguladora WHERE ativo AND excluido_em IS NULL ORDER BY sigla LIMIT 200',
        )
      ).map((r) => ({ id: num(r['id']), sigla: String(r['sigla']), nome: String(r['nome']) })),
      profissionais: (
        await l.consultar(
          `SELECT pp.id, pf.nome FROM profissional pp JOIN pessoa_fisica pf ON pf.id = pp.pessoa_fisica_id
            WHERE pp.excluido_em IS NULL ORDER BY pf.nome LIMIT 1000`,
        )
      ).map((r) => ({ id: num(r['id']), nome: String(r['nome']) })),
    }));
  }

  /** Pacientes pelo prontuário (número exato) ou pelo início do nome; até 20. */
  buscarPacientes(
    c: ContextoPortaPropria,
    busca: string,
  ): Promise<{ id: number; nome: string; prontuario: string; cns: string | null }[]> {
    const b = busca.trim();
    if (b.length < 2) return Promise.resolve([]);
    const porNumero = /^\d+$/.test(b);
    return this.ler(c, 'pacientes', async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome, p.numero_prontuario, pf.cns FROM paciente p
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND ${porNumero ? 'p.numero_prontuario = ?' : 'pf.nome LIKE ?'}
            ORDER BY pf.nome LIMIT 20`,
          [porNumero ? Number(b) : `${b.replace(/[%_\\]/g, '\\$&')}%`],
        )
      ).map((r) => ({
        id: num(r['id']),
        nome: String(r['nome']),
        prontuario: String(r['numero_prontuario']),
        cns: txtOuNull(r['cns']),
      })),
    );
  }

  listarNotificacoes(c: ContextoPortaPropria, paciente?: number): Promise<NotificacaoDoadorLida[]> {
    return this.ler(c, 'notificacoes', async (l, est) =>
      (
        await l.consultar(
          `${SQL_NOTIFICACAO}${paciente ? ' AND n.paciente_id = ?' : ''} ORDER BY n.notificado_em DESC, n.id DESC LIMIT 500`,
          paciente ? [est.id, paciente] : [est.id],
        )
      ).map((r) => notificacaoDe(r, est.fuso)),
    );
  }

  lerNotificacao(c: ContextoPortaPropria, idNotificacao: number): Promise<NotificacaoDoadorLida> {
    return this.ler(c, 'notificacao', async (l, est) => {
      const r = await l.uma(`${SQL_NOTIFICACAO} AND n.id = ?`, [est.id, idNotificacao]);
      if (!r) throw naoEncontrado('Notificação de doador');
      return notificacaoDe(r, est.fuso);
    });
  }

  private conferirNotificacao(e: Notif, fuso: string) {
    const utc = (v: string | null) => (v === null ? null : instanteDoLocal(v, fuso));
    const instantes = {
      notificado_em: utc(e.notificadoEm)!,
      obito_em: utc(e.obitoEm),
      protocolo_morte_encefalica_inicio_em: utc(e.protocoloInicioEm),
      protocolo_morte_encefalica_fim_em: utc(e.protocoloFimEm),
      abordagem_familiar_em: utc(e.abordagemFamiliarEm),
      desfecho_em: utc(e.desfechoEm),
    };
    const iso = (d: Date | null) => (d === null ? null : d.toISOString());
    const dados: DadosNotificacaoDoador = {
      tipoDoador: e.tipoDoador,
      notificadoEm: iso(instantes.notificado_em)!,
      obitoEm: iso(instantes.obito_em),
      protocoloInicioEm: iso(instantes.protocolo_morte_encefalica_inicio_em),
      protocoloFimEm: iso(instantes.protocolo_morte_encefalica_fim_em),
      abordagemFamiliarEm: iso(instantes.abordagem_familiar_em),
      familiaConsentiu: e.familiaConsentiu,
      orgaosDoados: e.orgaosDoados,
      desfecho: e.desfecho,
      desfechoEm: iso(instantes.desfecho_em),
      situacao: e.situacao,
    };
    const problemas = conferirNotificacaoDoador(dados);
    if (problemas.length) throw recusaRegra('Notificação de doador recusada', problemas);
    return instantes;
  }

  private async conferirReferencias(
    tx: { uma(sql: string, p?: unknown[]): Promise<Record<string, unknown> | null> },
    est: number,
    e: Notif,
  ): Promise<void> {
    const prof = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
      e.notificante,
    ]);
    if (!prof) throw naoEncontrado('Profissional notificante');
    if (e.central !== null) {
      const ce = await tx.uma('SELECT id FROM central_reguladora WHERE id = ? AND ativo', [e.central]);
      if (!ce) throw naoEncontrado('Central de transplantes');
    }
    if (e.atendimento !== null) {
      const at = await tx.uma('SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ?', [
        e.atendimento,
        est,
      ]);
      if (!at) throw naoEncontrado('Atendimento');
    }
    if (e.orgaosDoados.length) {
      const achados = await tx.uma(
        `SELECT COUNT(*) AS n FROM orgao_transplante WHERE codigo IN (${e.orgaosDoados.map(() => '?').join(', ')})`,
        [...e.orgaosDoados],
      );
      if (num(achados?.['n']) !== e.orgaosDoados.length) throw naoEncontrado('Órgão doado');
    }
  }

  async notificar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; numero: string }> {
    const e = entradaValida(esquemaNotificacao, entrada);
    return this.gravar(
      c,
      'faturamento.sus.doador.notificar',
      [T_NOTIFICACAO, T_SEQUENCIA],
      async (tx, est, usuario) => {
        const instantes = this.conferirNotificacao(e, est.fuso);
        const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
          e.paciente,
        ]);
        if (!pac) throw naoEncontrado('Paciente');
        await this.conferirReferencias(tx, est.id, e);
        await garantirSequencia(
          tx,
          { tipo: SEQUENCIA_NOTIFICACAO_DOADOR, estabelecimento: est.id, prefixo: 'ND-' },
          { usuario, agora: new Date() },
        );
        const numero = await tx.proximoNumero(SEQUENCIA_NOTIFICACAO_DOADOR);
        const id = await tx.incluir(T_NOTIFICACAO, {
          estabelecimento_id: est.id,
          numero: numero.formatado,
          paciente_id: e.paciente,
          atendimento_id: e.atendimento,
          tipo_doador: e.tipoDoador,
          notificante_profissional_id: e.notificante,
          central_reguladora_id: e.central,
          familia_consentiu: e.familiaConsentiu,
          orgaos_doados: e.orgaosDoados.length ? JSON.stringify(e.orgaosDoados) : null,
          desfecho: e.desfecho,
          situacao: e.situacao,
          observacao: e.observacao || null,
          ...instantes,
        });
        return { tabela: T_NOTIFICACAO, id, numero: numero.formatado };
      },
    );
  }

  async alterarNotificacao(
    c: ContextoPortaPropria,
    idNotificacao: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaAlteracaoNotificacao, entrada);
    return this.gravar(c, 'faturamento.sus.doador.alterar', [T_NOTIFICACAO], async (tx, est) => {
      const atual = await tx.uma(
        'SELECT situacao FROM notificacao_doador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [idNotificacao, est.id],
      );
      if (!atual) throw naoEncontrado('Notificação de doador');
      const t = conferirTransicaoNotificacao(String(atual['situacao']) as SituacaoNotificacao, e.situacao);
      if (t.length) throw recusaRegra('Notificação de doador recusada', t);
      const instantes = this.conferirNotificacao(e, est.fuso);
      await this.conferirReferencias(tx, est.id, e);
      await tx.alterar(T_NOTIFICACAO, idNotificacao, e.versao, {
        atendimento_id: e.atendimento,
        tipo_doador: e.tipoDoador,
        notificante_profissional_id: e.notificante,
        central_reguladora_id: e.central,
        familia_consentiu: e.familiaConsentiu,
        orgaos_doados: e.orgaosDoados.length ? JSON.stringify(e.orgaosDoados) : null,
        desfecho: e.desfecho,
        situacao: e.situacao,
        observacao: e.observacao || null,
        ...instantes,
      });
      return { tabela: T_NOTIFICACAO, id: idNotificacao };
    });
  }

  async registrarProtocolo(
    c: ContextoPortaPropria,
    idNotificacao: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaProtocolo, entrada);
    return this.gravar(c, 'faturamento.sus.doador.protocolo', [T_NOTIFICACAO], async (tx, est) => {
      const atual = await tx.uma(
        'SELECT situacao FROM notificacao_doador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [idNotificacao, est.id],
      );
      if (!atual) throw naoEncontrado('Notificação de doador');
      if (atual['situacao'] === 'cancelada')
        throw recusaRegra('Notificação de doador recusada', [
          { campo: 'situacao', mensagem: 'A notificação foi cancelada.' },
        ]);
      await tx.alterar(T_NOTIFICACAO, idNotificacao, e.versao, { protocolo_central: e.protocoloCentral });
      return { tabela: T_NOTIFICACAO, id: idNotificacao };
    });
  }

  listarInscricoes(
    c: ContextoPortaPropria,
    filtro: { situacao?: string; pendentes?: boolean; paciente?: number } = {},
  ): Promise<InscricaoLida[]> {
    return this.ler(c, 'inscricoes', async (l, est) => {
      const p: unknown[] = [est.id];
      let onde = '';
      if (filtro.situacao) {
        onde += ' AND i.situacao = ?';
        p.push(filtro.situacao);
      }
      if (filtro.paciente) {
        onde += ' AND i.paciente_id = ?';
        p.push(filtro.paciente);
      }
      if (filtro.pendentes)
        onde += ` AND EXISTS (SELECT 1 FROM inscricao_transplante_historico h
                    WHERE h.inscricao_transplante_id = i.id AND h.enviado_central_em IS NULL)`;
      return (
        await l.consultar(`${SQL_INSCRICAO}${onde} ORDER BY i.data_inscricao DESC, i.id DESC LIMIT 1000`, p)
      ).map(inscricaoDe);
    });
  }

  lerInscricao(
    c: ContextoPortaPropria,
    idInscricao: number,
  ): Promise<InscricaoLida & { historico: HistoricoInscricaoLido[] }> {
    return this.ler(c, 'inscricao', async (l, est) => {
      const r = await l.uma(`${SQL_INSCRICAO} AND i.id = ?`, [est.id, idInscricao]);
      if (!r) throw naoEncontrado('Inscrição de transplante');
      const historico = (
        await l.consultar(
          `SELECT id, operacao, ocorrido_em, motivo, enviado_central_em FROM inscricao_transplante_historico
            WHERE inscricao_transplante_id = ? ORDER BY ocorrido_em DESC, id DESC LIMIT 500`,
          [idInscricao],
        )
      ).map((h) => ({
        id: num(h['id']),
        operacao: String(h['operacao']),
        ocorridoEm: local(h['ocorrido_em'], est.fuso) ?? '',
        motivo: txtOuNull(h['motivo']),
        enviadoCentralEm: local(h['enviado_central_em'], est.fuso),
      }));
      return { ...inscricaoDe(r), historico };
    });
  }

  /** Arquivo de conferência (CSV) das inscrições do filtro, para conferir com a lista da central. */
  async conferencia(
    c: ContextoPortaPropria,
    filtro: { situacao?: string; pendentes?: boolean } = {},
  ): Promise<string> {
    const itens = await this.listarInscricoes(c, filtro);
    return csvConferenciaInscricoes(
      itens.map((i) => ({
        prontuario: i.prontuario,
        paciente: i.pacienteNome,
        cns: i.cns,
        orgao: i.orgaoDescricao,
        dataInscricao: i.dataInscricao,
        situacao: i.situacao,
        prioridade: i.prioridade,
        apto: i.apto,
        numeroCentral: i.numeroCentral,
        pendenteEnvio: i.pendentesEnvio > 0,
      })),
    );
  }

  private async historico(
    tx: { incluir(t: string, v: Record<string, unknown>): Promise<number> },
    inscricao: number,
    operacao: string,
    dados: Record<string, unknown>,
    motivo: string | null,
    usuario: number,
  ): Promise<void> {
    await tx.incluir(T_HISTORICO, {
      inscricao_transplante_id: inscricao,
      operacao,
      dados: JSON.stringify(dados),
      ocorrido_em: new Date(),
      usuario_id: usuario,
      motivo,
    });
  }

  private async conferirNotificacaoLigada(
    tx: { uma(sql: string, p?: unknown[]): Promise<Record<string, unknown> | null> },
    est: number,
    notificacao: number | null,
    responsavel: number | null,
  ): Promise<void> {
    if (notificacao !== null) {
      const n = await tx.uma('SELECT id FROM notificacao_doador WHERE id = ? AND estabelecimento_id = ?', [
        notificacao,
        est,
      ]);
      if (!n) throw naoEncontrado('Notificação de doador');
    }
    if (responsavel !== null) {
      const p = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
        responsavel,
      ]);
      if (!p) throw naoEncontrado('Profissional responsável');
    }
  }

  async inscrever(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaInscricao, entrada);
    return this.gravar(
      c,
      'faturamento.sus.receptor.inscrever',
      [T_INSCRICAO, T_HISTORICO],
      async (tx, est, usuario) => {
        const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
          e.paciente,
        ]);
        if (!pac) throw naoEncontrado('Paciente');
        const org = await tx.uma('SELECT id FROM orgao_transplante WHERE id = ? AND ativo', [e.orgao]);
        if (!org) throw naoEncontrado('Órgão');
        await this.conferirNotificacaoLigada(tx, est.id, e.notificacaoDoador, e.responsavel);
        const outras = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT id, situacao FROM inscricao_transplante
            WHERE estabelecimento_id = ? AND paciente_id = ? AND orgao_transplante_id = ? AND excluido_em IS NULL`,
            [est.id, e.paciente, e.orgao],
          )
        ).map((r) => ({ id: num(r['id']), situacao: String(r['situacao']) as SituacaoInscricao }));
        const dados: DadosInscricao = {
          dataInscricao: e.dataInscricao,
          situacao: e.situacao,
          apto: e.apto,
          motivo: e.motivo,
          dataTransplante: e.dataTransplante,
        };
        const r = conferirInscricao(dados, null, outras);
        if (r.problemas.length) throw recusaRegra('Inscrição de transplante recusada', r.problemas);
        const linha = {
          estabelecimento_id: est.id,
          paciente_id: e.paciente,
          orgao_transplante_id: e.orgao,
          numero_inscricao_central: e.numeroCentral || null,
          tipo_paciente: e.tipoPaciente,
          data_inscricao: e.dataInscricao,
          apto: e.apto,
          data_alteracao_aptidao: e.apto ? null : e.dataInscricao,
          motivo_aptidao: e.motivo || null,
          prioridade: e.prioridade,
          situacao: e.situacao,
          notificacao_doador_id: e.notificacaoDoador,
          data_transplante: e.dataTransplante,
          responsavel_profissional_id: e.responsavel,
        };
        const id = await tx.incluir(T_INSCRICAO, linha);
        await this.historico(tx, id, r.operacao, linha, e.motivo || null, usuario);
        return { tabela: T_INSCRICAO, id };
      },
    );
  }

  async alterarInscricao(
    c: ContextoPortaPropria,
    idInscricao: number,
    entrada: unknown,
  ): Promise<{ id: number; operacao: string }> {
    const e = entradaValida(esquemaAlteracaoInscricao, entrada);
    return this.gravar(
      c,
      'faturamento.sus.receptor.alterar',
      [T_INSCRICAO, T_HISTORICO],
      async (tx, est, usuario) => {
        const atual = await tx.uma(
          `SELECT id, paciente_id, orgao_transplante_id, data_inscricao, situacao, apto, motivo_aptidao, data_transplante
             FROM inscricao_transplante WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [idInscricao, est.id],
        );
        if (!atual) throw naoEncontrado('Inscrição de transplante');
        await this.conferirNotificacaoLigada(tx, est.id, e.notificacaoDoador, e.responsavel);
        const outras = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT id, situacao FROM inscricao_transplante
              WHERE estabelecimento_id = ? AND paciente_id = ? AND orgao_transplante_id = ? AND id <> ?
                AND excluido_em IS NULL`,
            [est.id, num(atual['paciente_id']), num(atual['orgao_transplante_id']), idInscricao],
          )
        ).map((r) => ({ id: num(r['id']), situacao: String(r['situacao']) as SituacaoInscricao }));
        const antes: DadosInscricao = {
          dataInscricao: dataIso(atual['data_inscricao'])!,
          situacao: String(atual['situacao']) as SituacaoInscricao,
          apto: bool(atual['apto']),
          motivo: txtOuNull(atual['motivo_aptidao']),
          dataTransplante: dataIso(atual['data_transplante']),
        };
        const r = conferirInscricao(
          {
            dataInscricao: e.dataInscricao,
            situacao: e.situacao,
            apto: e.apto,
            motivo: e.motivo,
            dataTransplante: e.dataTransplante,
          },
          antes,
          outras,
        );
        if (r.problemas.length) throw recusaRegra('Inscrição de transplante recusada', r.problemas);
        const hoje = dataHora(new Date(), est.fuso)!.slice(0, 10);
        const valores = {
          numero_inscricao_central: e.numeroCentral || null,
          data_inscricao: e.dataInscricao,
          apto: e.apto,
          data_alteracao_aptidao: antes.apto !== e.apto ? hoje : undefined,
          motivo_aptidao: e.motivo || null,
          prioridade: e.prioridade,
          situacao: e.situacao,
          notificacao_doador_id: e.notificacaoDoador,
          data_transplante: e.dataTransplante,
          responsavel_profissional_id: e.responsavel,
        };
        const limpos = Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== undefined));
        await tx.alterar(T_INSCRICAO, idInscricao, e.versao, limpos);
        await this.historico(tx, idInscricao, r.operacao, limpos, e.motivo || null, usuario);
        return { tabela: T_INSCRICAO, id: idInscricao, operacao: r.operacao };
      },
    );
  }

  /** O número devolvido pela central e o envio das linhas pendentes do histórico (com a versão lida da inscrição). */
  async registrarCentral(
    c: ContextoPortaPropria,
    idInscricao: number,
    entrada: unknown,
  ): Promise<{ id: number; enviados: number }> {
    const e = entradaValida(esquemaCentral, entrada);
    const { id, enviados } = await this.gravar(
      c,
      'faturamento.sus.receptor.central',
      [T_INSCRICAO, T_HISTORICO],
      async (tx, est) => {
        const atual = await tx.uma(
          'SELECT numero_inscricao_central FROM inscricao_transplante WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [idInscricao, est.id],
        );
        if (!atual) throw naoEncontrado('Inscrição de transplante');
        const numero = e.numeroCentral || txtOuNull(atual['numero_inscricao_central']);
        if (e.marcarEnviado && !numero)
          throw recusaRegra('Registro da central recusado', [
            { campo: 'numeroCentral', mensagem: 'Informe o número da inscrição devolvido pela central.' },
          ]);
        await tx.alterar(T_INSCRICAO, idInscricao, e.versao, { numero_inscricao_central: numero });
        let enviados = 0;
        if (e.marcarEnviado) {
          const pendentes = await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT id, versao FROM inscricao_transplante_historico
            WHERE inscricao_transplante_id = ? AND enviado_central_em IS NULL`,
            [idInscricao],
          );
          const agora = new Date();
          for (const h of pendentes)
            await tx.alterar(T_HISTORICO, num(h['id']), num(h['versao']), { enviado_central_em: agora });
          enviados = pendentes.length;
        }
        return { tabela: T_INSCRICAO, id: idInscricao, enviados };
      },
    );
    return { id: id as number, enviados };
  }
}
