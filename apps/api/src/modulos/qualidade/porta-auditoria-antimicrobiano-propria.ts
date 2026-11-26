// Porta PRÓPRIA da auditoria da prescrição de antimicrobiano pela comissão de controle de infecção (F7, 03-PEP linha
// 110) sobre o MariaDB do cliente, pelo @sgh/nucleo. Lê as fichas de antimicrobiano do estabelecimento
// (ficha_antimicrobiano, gravada junto da prescrição ou avulsa) com a última auditoria, o histórico das auditorias
// (auditoria_prescricao_ccih) e o cadastro (tipo_auditoria_ccih e parecer_padrao_auditoria_antimicrobiano). Grava, numa
// operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação), a auditoria e o parecer que
// ela deixa na ficha (avaliação, avaliador e data).
// Melhoria: a fila mostra as fichas pendentes primeiro, por paciente, com o prazo previsto do tratamento; a regra
// (avaliarAuditoriaAntimicrobiano) decide na hora; a ficha é travada e a versão vista conferida (dois auditores ao mesmo
// tempo não se sobrepõem); a nova auditoria encerra a anterior ativa da mesma ficha, que fica no histórico (nada é
// apagado).
import {
  type AcaoTipoAuditoria,
  type AdequacaoAuditoria,
  atendimentoDaAuditoria,
  avaliarAuditoriaAntimicrobiano,
  type IndicacaoAuditoria,
  MENSAGEM_FICHA_SEM_ATENDIMENTO,
  MENSAGENS_AUDITORIA_ANTIMICROBIANO,
  type ParecerAuditoriaAntimicrobiano,
} from '@sgh/dominio-qualidade';
import { ErroOperacao, type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  dataIso,
  exigirUsuario,
  instante,
  type L,
  lerNoEstabelecimento,
  type Linha,
  n,
  nn,
  type NucleoQualidade,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';

const TETO = 500;

export const TABELAS_AUDITORIA_ANTIMICROBIANO = [
  'auditoria_prescricao_ccih',
  'ficha_antimicrobiano',
] as const;

export interface FichaParaAuditoria {
  readonly id: number;
  readonly versao: number;
  readonly paciente: number;
  readonly nome: string;
  /** Atendimento da ficha; nulo só na ficha migrada sem atendimento ligado na origem. */
  readonly atendimento: number | null;
  /** Item da prescrição; nulo só na ficha migrada sem item ligado na origem. */
  readonly item: number | null;
  readonly antimicrobiano: string;
  readonly finalidade: string;
  readonly finalidadeCodigo: string;
  readonly sitio: string | null;
  readonly indicacaoClinica: string;
  readonly culturaColetada: boolean;
  readonly inicio: string | null;
  readonly fimPrevisto: string | null;
  readonly diasPrevistos: number;
  readonly prescritor: string;
  readonly avaliacao: string;
  readonly avaliadaEm: string | null;
  readonly ultimoParecer: string | null;
}

export interface AuditoriaRegistrada {
  readonly id: number;
  readonly ficha: number | null;
  readonly item: number | null;
  readonly paciente: number;
  readonly auditadaEm: string;
  readonly auditor: string;
  readonly avaliavel: boolean;
  readonly droga: string | null;
  readonly dose: string | null;
  readonly tempo: string | null;
  readonly via: string | null;
  readonly indicacao: string | null;
  readonly parecer: string;
  readonly permiteProrrogacao: boolean;
  readonly recomendacao: string | null;
  readonly situacao: string;
  readonly tipo: string | null;
  readonly parecerPadrao: string | null;
  readonly versao: number;
}

export interface CadastroAuditoria {
  readonly tipos: {
    id: number;
    codigo: string;
    descricao: string;
    acao: string;
    padrao: boolean;
    ativo: boolean;
  }[];
  readonly pareceres: {
    id: number;
    codigo: string;
    descricao: string;
    permiteProrrogacao: boolean;
    antimicrobiano: number | null;
    ativo: boolean;
  }[];
}

export interface NovaAuditoria {
  /** A versão da ficha que o auditor viu (conferida na gravação). */
  readonly versaoFicha: number;
  readonly avaliavel: boolean;
  readonly droga: AdequacaoAuditoria;
  readonly dose: AdequacaoAuditoria;
  readonly tempo: AdequacaoAuditoria;
  readonly via: AdequacaoAuditoria;
  readonly indicacao: IndicacaoAuditoria | null;
  readonly parecer: ParecerAuditoriaAntimicrobiano;
  readonly permiteProrrogacao: boolean | null;
  readonly recomendacao: string | null;
  readonly tipo: number | null;
  readonly parecerPadrao: number | null;
}

// A ficha migrada pode vir sem item de prescrição, antimicrobiano, finalidade ou prescritor (a CHECK da ficha só exige
// tudo fora da migração): LEFT JOIN, para ela aparecer na fila. O atendimento da ficha sem atendimento próprio vem da
// prescrição do item, quando há.
const SQL_FICHA = `SELECT f.id, f.versao, f.paciente_id, pf.nome, COALESCE(f.atendimento_id, pi_p.atendimento_id) AS atendimento_id,
       f.prescricao_item_id,
       a.descricao AS antimicrobiano, ft.descricao AS finalidade, ft.codigo AS finalidade_codigo,
       si.descricao AS sitio, f.justificativa, f.cultura_coletada, f.data_inicio, f.data_fim_prevista,
       f.dias_previstos, COALESCE(pr.nome_exibicao, ppf.nome) AS prescritor, f.avaliacao_situacao, f.avaliado_em,
       (SELECT x.parecer FROM auditoria_prescricao_ccih x
         WHERE x.ficha_antimicrobiano_id = f.id AND x.excluido_em IS NULL ORDER BY x.auditado_em DESC, x.id DESC LIMIT 1)
         AS ultimo_parecer
  FROM ficha_antimicrobiano f
  JOIN paciente p ON p.id = f.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN prescricao_item pi_i ON pi_i.id = f.prescricao_item_id
  LEFT JOIN prescricao pi_p ON pi_p.id = pi_i.prescricao_id
  LEFT JOIN antimicrobiano a ON a.id = f.antimicrobiano_id
  LEFT JOIN finalidade_terapeutica ft ON ft.id = f.finalidade_terapeutica_id
  LEFT JOIN sitio_infeccao si ON si.id = f.sitio_infeccao_id
  LEFT JOIN profissional pr ON pr.id = f.prescritor_profissional_id
  LEFT JOIN pessoa_fisica ppf ON ppf.id = pr.pessoa_fisica_id
 WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL`;

const SQL_AUDITORIA = `SELECT x.*, u.nome AS auditor, t.descricao AS tipo, pp.descricao AS parecer_padrao
  FROM auditoria_prescricao_ccih x
  JOIN usuario u ON u.id = x.auditor_usuario_id
  LEFT JOIN tipo_auditoria_ccih t ON t.id = x.tipo_auditoria_ccih_id
  LEFT JOIN parecer_padrao_auditoria_antimicrobiano pp ON pp.id = x.parecer_padrao_auditoria_antimicrobiano_id`;

export function fichaDe(x: Linha): FichaParaAuditoria {
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    paciente: n(x['paciente_id']),
    nome: texto(x['nome']),
    atendimento: nn(x['atendimento_id']),
    item: nn(x['prescricao_item_id']),
    antimicrobiano: texto(x['antimicrobiano']),
    finalidade: texto(x['finalidade']),
    finalidadeCodigo: texto(x['finalidade_codigo']),
    sitio: textoN(x['sitio']),
    indicacaoClinica: texto(x['justificativa']),
    culturaColetada: verdadeiro(x['cultura_coletada']),
    inicio: dataIso(x['data_inicio']),
    fimPrevisto: dataIso(x['data_fim_prevista']),
    diasPrevistos: n(x['dias_previstos']),
    prescritor: texto(x['prescritor']),
    avaliacao: texto(x['avaliacao_situacao']),
    avaliadaEm: x['avaliado_em'] ? instante(x['avaliado_em']) : null,
    ultimoParecer: textoN(x['ultimo_parecer']),
  };
}

function auditoriaDe(x: Linha): AuditoriaRegistrada {
  return {
    id: n(x['id']),
    ficha: nn(x['ficha_antimicrobiano_id']),
    item: nn(x['prescricao_item_id']),
    paciente: n(x['paciente_id']),
    auditadaEm: instante(x['auditado_em']),
    auditor: texto(x['auditor']),
    avaliavel: verdadeiro(x['avaliavel']),
    droga: textoN(x['adequacao_droga']),
    dose: textoN(x['adequacao_dose']),
    tempo: textoN(x['adequacao_tempo']),
    via: textoN(x['adequacao_via']),
    indicacao: textoN(x['indicacao']),
    parecer: texto(x['parecer']),
    permiteProrrogacao: verdadeiro(x['permite_prorrogacao']),
    recomendacao: textoN(x['recomendacao']),
    situacao: texto(x['situacao']),
    tipo: textoN(x['tipo']),
    parecerPadrao: textoN(x['parecer_padrao']),
    versao: n(x['versao']),
  };
}

const recusar = (status: number, codigo: string, detalhe: string) =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

export class PortaAuditoriaAntimicrobianoPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  /** As fichas do estabelecimento (as pendentes de avaliação primeiro), opcionalmente de um paciente. */
  fila(
    c: ContextoPortaM18,
    f: { soPendentes: boolean; paciente: number | null },
  ): Promise<FichaParaAuditoria[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `${SQL_FICHA} ${f.soPendentes ? "AND f.avaliacao_situacao = 'pendente'" : ''}
           ${f.paciente === null ? '' : 'AND f.paciente_id = ?'}
         ORDER BY (f.avaliacao_situacao = 'pendente') DESC, f.data_inicio DESC, f.id DESC`,
        [est, ...(f.paciente === null ? [] : [f.paciente])],
        { teto: TETO },
      );
      return r.map(fichaDe);
    });
  }

  /** As auditorias de uma ficha ou de um paciente (as mais recentes primeiro), com as encerradas. */
  historico(c: ContextoPortaM18, f: { ficha?: number; paciente?: number }): Promise<AuditoriaRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const w = ['x.estabelecimento_id = ?', 'x.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.ficha !== undefined) {
        w.push('x.ficha_antimicrobiano_id = ?');
        p.push(f.ficha);
      }
      if (f.paciente !== undefined) {
        w.push('x.paciente_id = ?');
        p.push(f.paciente);
      }
      const r = await l.consultar<Linha>(
        `${SQL_AUDITORIA} WHERE ${w.join(' AND ')} ORDER BY x.auditado_em DESC, x.id DESC`,
        p,
        { teto: TETO },
      );
      return r.map(auditoriaDe);
    });
  }

  /** Os tipos de auditoria e os pareceres padrão que valem neste estabelecimento. */
  cadastro(c: ContextoPortaM18): Promise<CadastroAuditoria> {
    return this.ler(c, async (l, est) => {
      const tipos = await l.consultar<Linha>(
        `SELECT id, codigo, descricao, acao, padrao, ativo FROM tipo_auditoria_ccih
          ORDER BY ativo DESC, padrao DESC, descricao`,
        [],
        { teto: TETO },
      );
      const pareceres = await l.consultar<Linha>(
        `SELECT id, codigo, descricao, permite_prorrogacao, antimicrobiano_id, ativo
           FROM parecer_padrao_auditoria_antimicrobiano
          WHERE (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          ORDER BY ativo DESC, descricao`,
        [est],
        { teto: TETO },
      );
      return {
        tipos: tipos.map((t) => ({
          id: n(t['id']),
          codigo: texto(t['codigo']),
          descricao: texto(t['descricao']),
          acao: texto(t['acao']),
          padrao: verdadeiro(t['padrao']),
          ativo: verdadeiro(t['ativo']),
        })),
        pareceres: pareceres.map((p) => ({
          id: n(p['id']),
          codigo: texto(p['codigo']),
          descricao: texto(p['descricao']),
          permiteProrrogacao: verdadeiro(p['permite_prorrogacao']),
          antimicrobiano: nn(p['antimicrobiano_id']),
          ativo: verdadeiro(p['ativo']),
        })),
      };
    });
  }

  /** Registra a auditoria da ficha e o parecer na ficha; encerra a auditoria ativa anterior da mesma ficha. */
  registrar(
    c: ContextoPortaM18,
    login: string,
    ficha: number,
    e: NovaAuditoria,
    trilha: (r: { id: number }) => TrilhaDaGravacao,
  ): Promise<{ id: number; ficha: number; avaliacao: string; encerradas: number }> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.ccih.auditoria-antimicrobiano',
      tabelas: TABELAS_AUDITORIA_ANTIMICROBIANO,
      trilha,
      gravador: (tx: TxOperacao, est: number) => ({ tx, est }),
      fn: ({ tx, est }) => this.gravar(tx, est, login, ficha, e),
    });
  }

  private async gravar(tx: TxOperacao, est: number, login: string, ficha: number, e: NovaAuditoria) {
    const usuario = await exigirUsuario(tx, login);
    const pr = await tx.uma<Linha>(
      `SELECT profissional_id FROM usuario_profissional
        WHERE usuario_id = ? AND excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
          AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY id DESC LIMIT 1`,
      [usuario],
    );
    if (!pr)
      throw recusa(
        'auditor-sem-profissional',
        'O parecer na ficha é assinado por um profissional: a conta não tem vínculo vigente com profissional.',
      );
    const [fi] = await tx.consultarParaAtualizar<Linha>(
      `SELECT f.id, f.versao, f.paciente_id, COALESCE(f.atendimento_id, p.atendimento_id) AS atendimento_id, f.origem,
              f.prescricao_item_id, f.antimicrobiano_id, i.item_prescritivel_id, ft.codigo AS finalidade
         FROM ficha_antimicrobiano f
         LEFT JOIN prescricao_item i ON i.id = f.prescricao_item_id
         LEFT JOIN prescricao p ON p.id = i.prescricao_id
         LEFT JOIN finalidade_terapeutica ft ON ft.id = f.finalidade_terapeutica_id
        WHERE f.id = ? AND f.estabelecimento_id = ? AND f.excluido_em IS NULL`,
      [ficha, est],
    );
    if (!fi) throw recusar(404, 'registro-inexistente', 'A ficha de antimicrobiano não foi encontrada.');
    if (n(fi['versao']) !== e.versaoFicha)
      throw recusa(
        'conflito-versao',
        'A ficha mudou desde que foi aberta: atualize a fila e audite de novo.',
      );
    const tipo = e.tipo
      ? await tx.uma<Linha>('SELECT id, acao, ativo FROM tipo_auditoria_ccih WHERE id = ?', [e.tipo])
      : null;
    if (e.tipo && !tipo) throw recusar(422, 'tipo-auditoria-inexistente', 'O tipo de auditoria não existe.');
    const padrao = e.parecerPadrao
      ? await tx.uma<Linha>(
          `SELECT id, permite_prorrogacao, ativo FROM parecer_padrao_auditoria_antimicrobiano
            WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
              AND (antimicrobiano_id IS NULL OR antimicrobiano_id = ?)`,
          [e.parecerPadrao, est, n(fi['antimicrobiano_id'])],
        )
      : null;
    if (e.parecerPadrao && !padrao)
      throw recusar(
        422,
        'parecer-padrao-nao-aplicavel',
        'O parecer padrão não vale para este estabelecimento ou para este antimicrobiano.',
      );
    const r = avaliarAuditoriaAntimicrobiano(e, {
      tipo: tipo
        ? { ativo: verdadeiro(tipo['ativo']), acao: texto(tipo['acao']) as AcaoTipoAuditoria }
        : null,
      parecerPadrao: padrao
        ? {
            ativo: verdadeiro(padrao['ativo']),
            permiteProrrogacao: verdadeiro(padrao['permite_prorrogacao']),
          }
        : null,
      finalidade: textoN(fi['finalidade']),
    });
    if (!r.ok) {
      const cod = r.recusas[0] ?? 'parecer-obrigatorio';
      throw recusar(422, cod, r.recusas.map((x) => MENSAGENS_AUDITORIA_ANTIMICROBIANO[x]).join(' '));
    }
    const g = r.gravar;
    const anteriores = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM auditoria_prescricao_ccih
        WHERE ficha_antimicrobiano_id = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
      [ficha],
    );
    for (const a of anteriores)
      await tx.alterar('auditoria_prescricao_ccih', n(a['id']), n(a['versao']), { situacao: 'encerrada' });
    // O atendimento é o da ficha ou, sem ele, o da prescrição do item. A ficha migrada sem nenhum dos dois é auditada
    // com o atendimento nulo (D2); a do sistema sem atendimento é recusada pelo domínio (nunca o atendimento 0).
    const at = atendimentoDaAuditoria({
      atendimento: nn(fi['atendimento_id']),
      migrada: texto(fi['origem']) === 'migracao',
    });
    if (!at.ok) throw recusar(409, at.recusa, MENSAGEM_FICHA_SEM_ATENDIMENTO);
    const atendimento = at.atendimento;
    const agora = new Date();
    const id = await tx.incluir('auditoria_prescricao_ccih', {
      estabelecimento_id: est,
      atendimento_id: atendimento,
      paciente_id: n(fi['paciente_id']),
      prescricao_item_id: nn(fi['prescricao_item_id']),
      item_prescritivel_id: nn(fi['item_prescritivel_id']),
      ficha_antimicrobiano_id: ficha,
      tipo_auditoria_ccih_id: e.tipo,
      parecer_padrao_auditoria_antimicrobiano_id: e.parecerPadrao,
      auditado_em: agora,
      auditor_usuario_id: usuario,
      avaliavel: g.avaliavel,
      adequacao_droga: g.droga,
      adequacao_dose: g.dose,
      adequacao_tempo: g.tempo,
      adequacao_via: g.via,
      indicacao: g.indicacao,
      parecer: g.parecer,
      permite_prorrogacao: g.permiteProrrogacao,
      recomendacao: g.recomendacao,
      situacao: 'ativa',
      origem: 'sistema',
    });
    await tx.alterar('ficha_antimicrobiano', ficha, e.versaoFicha, {
      avaliacao_situacao: g.avaliacaoFicha,
      avaliado_por_profissional_id: n(pr['profissional_id']),
      avaliado_em: agora,
      parecer: g.recomendacao,
    });
    return { id, ficha, avaliacao: g.avaliacaoFicha, encerradas: anteriores.length };
  }
}
