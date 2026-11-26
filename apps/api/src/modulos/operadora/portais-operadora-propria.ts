// F8 (08-SGO linha 114, C3-027): a porta própria dos portais externos da operadora — beneficiário, empresa contratante
// e corretor — no MariaDB do cliente. Cada gravação é uma operação do Executor com a trilha na mesma transação.
// - Contas (conta_portal_beneficiario, conta_portal_contratante, conta_portal_corretor): convite pela operadora, ativação
//   com o aceite dos termos, bloqueio com motivo, desbloqueio (zera as tentativas) e encerramento, com a trava de versão.
//   A conta liga a identidade única da plataforma (usuario_id) ao titular; senha e segundo fator nunca ficam aqui.
// - Solicitações (solicitacao_portal_beneficiario): abertas pelo portal, sempre sobre o beneficiário da conta (o próprio
//   e os dependentes dele, ou os da contratante), com o número SP; decididas pela operadora; canceladas só pelo dono.
//   A solicitação nunca altera o cadastro sozinha.
// - Exclusão em lote da contratante (movimentacao_lote_contratante e _item): crítica linha a linha pelo domínio e, no
//   processamento, a exclusão dos aceitos em beneficiario_plano (situação, data e motivo) com a versão de cada um.
// - Cartão digital: leitura do beneficiário da conta. Mensagens: o canal da plataforma está desligado (DP-44 a).
// As regras de negócio ficam no domínio (`@sgh/dominio-operadora`); aqui só a leitura, a trava de versão e a gravação.
import {
  type AcaoContaPortal,
  type AcaoSolicitacaoPortal,
  avisoDaSolicitacao,
  type BeneficiarioDoLote,
  type CartaoDigital,
  cartaoDigitalValido,
  celularNormalizado,
  type ContaPortalEntrada,
  criticarExclusaoLote,
  type LinhaExclusaoLote,
  problemasDaContaPortal,
  problemasDaSolicitacaoPortal,
  proximaSituacaoContaPortal,
  proximaSituacaoSolicitacaoPortal,
  type SituacaoContaPortal,
  type SituacaoSolicitacaoPortal,
  situacaoDoLoteCriticado,
  situacaoDoLoteProcessado,
  type SolicitacaoPortalEntrada,
  type TipoPortalOperadora,
} from '@sgh/dominio-operadora';
import { definirOperacao, type Executor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  instanteIso,
  marcadores,
  type NucleoOperadora,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_PORTAIS_OPERADORA = Symbol('PORTA_PORTAIS_OPERADORA');

export const TABELAS_PORTAIS_OPERADORA = [
  'conta_portal_beneficiario',
  'conta_portal_contratante',
  'conta_portal_corretor',
  'solicitacao_portal_beneficiario',
  'movimentacao_lote_contratante',
  'movimentacao_lote_contratante_item',
  'beneficiario_plano',
] as const;

export const METODOS_PORTAIS_OPERADORA = new Set([
  'contas',
  'contaDoUsuario',
  'convidarConta',
  'mudarSituacaoConta',
  'solicitacoes',
  'abrirSolicitacao',
  'decidirSolicitacao',
  'receberExclusaoLote',
  'processarLote',
  'lotes',
  'itensDoLote',
  'cartaoDigital',
]);

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
const esquemaEntrada = z.record(z.string(), z.unknown());

const TABELA_CONTA: Readonly<Record<TipoPortalOperadora, string>> = {
  beneficiario: 'conta_portal_beneficiario',
  contratante: 'conta_portal_contratante',
  corretor: 'conta_portal_corretor',
};

export interface ContaPortalLida {
  readonly id: number;
  readonly portal: TipoPortalOperadora;
  readonly operadora: number;
  readonly login: string;
  readonly email: string | null;
  readonly celular: string | null;
  readonly situacao: SituacaoContaPortal;
  readonly usuario: number | null;
  readonly beneficiario: number | null;
  readonly contratante: number | null;
  readonly gestor: number | null;
  readonly corretora: number | null;
  readonly vendedor: number | null;
  readonly recebeNotificacoes: boolean;
  readonly motivoBloqueio: string | null;
  readonly convidadaEm: string | null;
  readonly ativadaEm: string | null;
  readonly versao: number;
}

export interface SolicitacaoPortalLida {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly situacao: SituacaoSolicitacaoPortal;
  readonly contaBeneficiario: number | null;
  readonly contaContratante: number | null;
  readonly beneficiario: number | null;
  readonly beneficiarioNome: string | null;
  readonly dataEfeito: string | null;
  readonly resultado: string | null;
  readonly criadaEm: string;
  readonly analisadaEm: string | null;
  readonly versao: number;
}

export interface LoteContratanteLido {
  readonly id: number;
  readonly numero: string;
  readonly contratante: number;
  readonly situacao: string;
  readonly registros: number;
  readonly aceitos: number;
  readonly rejeitados: number;
  readonly recebidoEm: string;
  readonly processadoEm: string | null;
  readonly versao: number;
}

const recusaDe = (problemas: readonly { codigo: string; campo: string }[]) => {
  const p = problemas[0];
  return recusa(
    p?.codigo ?? 'recusa',
    `Recusado: ${problemas.map((x) => x.codigo).join(', ')}.`,
    p?.campo ? { campos: [p.campo] } : {},
  );
};

const contaDe = (portal: TipoPortalOperadora, x: Record<string, unknown>): ContaPortalLida => ({
  id: Number(x['id']),
  portal,
  operadora: Number(x['operadora_saude_id']),
  login: textoObrigatorio(x['login']),
  email: texto(x['email']),
  celular: texto(x['telefone_celular']),
  situacao: textoObrigatorio(x['situacao']) as SituacaoContaPortal,
  usuario: inteiro(x['usuario_id']),
  beneficiario: inteiro(x['beneficiario_plano_id']),
  contratante: inteiro(x['contratante_plano_id']),
  gestor: inteiro(x['gestor_pessoa_fisica_id']),
  corretora: inteiro(x['corretora_venda_id']),
  vendedor: inteiro(x['vendedor_plano_id']),
  recebeNotificacoes: x['recebe_notificacoes'] === undefined ? true : booleano(x['recebe_notificacoes']),
  motivoBloqueio: texto(x['motivo_bloqueio']),
  convidadaEm: instanteIso(x['convidada_em']),
  ativadaEm: instanteIso(x['ativada_em']),
  versao: inteiro(x['versao']) ?? 1,
});

const SOLICITACAO_SQL = `SELECT s.id, s.numero, s.tipo_solicitacao, s.situacao, s.conta_portal_beneficiario_id,
       s.conta_portal_contratante_id, s.beneficiario_plano_id, pf.nome AS beneficiario_nome, s.data_efeito, s.resultado,
       s.criado_em, s.analisado_em, s.versao
  FROM solicitacao_portal_beneficiario s
  LEFT JOIN beneficiario_plano b ON b.id = s.beneficiario_plano_id
  LEFT JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
 WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

const solicitacaoDe = (x: Record<string, unknown>): SolicitacaoPortalLida => ({
  id: Number(x['id']),
  numero: textoObrigatorio(x['numero']),
  tipo: textoObrigatorio(x['tipo_solicitacao']),
  situacao: textoObrigatorio(x['situacao']) as SituacaoSolicitacaoPortal,
  contaBeneficiario: inteiro(x['conta_portal_beneficiario_id']),
  contaContratante: inteiro(x['conta_portal_contratante_id']),
  beneficiario: inteiro(x['beneficiario_plano_id']),
  beneficiarioNome: texto(x['beneficiario_nome']),
  dataEfeito: dataIso(x['data_efeito']),
  resultado: texto(x['resultado']),
  criadaEm: instanteIso(x['criado_em']) ?? '',
  analisadaEm: instanteIso(x['analisado_em']),
  versao: inteiro(x['versao']) ?? 1,
});

const loteDe = (x: Record<string, unknown>): LoteContratanteLido => ({
  id: Number(x['id']),
  numero: textoObrigatorio(x['numero']),
  contratante: Number(x['contratante_plano_id']),
  situacao: textoObrigatorio(x['situacao']),
  registros: inteiro(x['total_registros']) ?? 0,
  aceitos: inteiro(x['total_aceitos']) ?? 0,
  rejeitados: inteiro(x['total_rejeitados']) ?? 0,
  recebidoEm: instanteIso(x['recebido_em']) ?? '',
  processadoEm: instanteIso(x['processado_em']),
  versao: inteiro(x['versao']) ?? 1,
});

/** Hoje (data local do servidor do banco) em AAAA-MM-DD. */
const hojeDe = async (l: Pick<Leitor, 'uma'>): Promise<string> =>
  dataIso((await l.uma('SELECT CURDATE() AS hoje'))?.['hoje']) ?? new Date().toISOString().slice(0, 10);

export class PortaPortaisOperadoraPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-portais' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar<T extends Gravado>(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, T>({
      nome,
      tabelas: TABELAS_PORTAIS_OPERADORA,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  /** As operadoras ligadas ao estabelecimento da sessão (a conta é da operadora). */
  private async operadorasDo(l: Pick<Leitor, 'consultar'>, est: number): Promise<number[]> {
    const r = await l.consultar(
      'SELECT operadora_saude_id FROM operadora_saude_estabelecimento WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [est],
    );
    return r.map((x) => Number(x['operadora_saude_id']));
  }

  // ── Contas ──────────────────────────────────────────────────────────────────────────────────────

  /** As contas de um portal das operadoras do estabelecimento, da mais nova; 200 no máximo. */
  contas(
    c: ContextoPorta,
    portal: TipoPortalOperadora,
    situacao?: SituacaoContaPortal,
  ): Promise<ContaPortalLida[]> {
    return this.ler(c, async (l, est) => {
      const ops = await this.operadorasDo(l, est);
      if (!ops.length) return [];
      const p: unknown[] = [...ops];
      let filtro = '';
      if (situacao) {
        filtro = ' AND situacao = ?';
        p.push(situacao);
      }
      const r = await l.consultar(
        `SELECT * FROM ${TABELA_CONTA[portal]} WHERE operadora_saude_id IN (${marcadores(ops.length)}) AND excluido_em IS NULL${filtro} ORDER BY id DESC LIMIT 200`,
        p,
      );
      return r.map((x) => contaDe(portal, x));
    });
  }

  /** A conta ativa do usuário da plataforma num portal (a sessão do portal); nula se não houver. */
  contaDoUsuario(
    c: ContextoPorta,
    portal: TipoPortalOperadora,
    usuario: number,
  ): Promise<ContaPortalLida | null> {
    return this.ler(c, async (l, est) => {
      const ops = await this.operadorasDo(l, est);
      if (!ops.length) return null;
      const x = await l.uma(
        `SELECT * FROM ${TABELA_CONTA[portal]} WHERE usuario_id = ? AND situacao = 'ativa' AND excluido_em IS NULL
            AND operadora_saude_id IN (${marcadores(ops.length)}) ORDER BY id DESC LIMIT 1`,
        [usuario, ...ops],
      );
      return x ? contaDe(portal, x) : null;
    });
  }

  /** O convite da conta pela operadora: o titular tem de ser da operadora ligada ao estabelecimento. */
  convidarConta(
    c: ContextoPorta,
    e: ContaPortalEntrada & { readonly usuario: number | null },
    trilha: Trilha,
  ): Promise<Gravado> {
    const problemas = problemasDaContaPortal(e);
    if (problemas.length) return Promise.reject(recusaDe(problemas));
    const tabela = TABELA_CONTA[e.portal];
    return this.gravar(c, `operadora.portal-${e.portal}.conta.convidar`, tabela, trilha, async (tx, est) => {
      const ops = await this.operadorasDo(tx, est);
      let operadora: number | null;
      if (e.portal === 'beneficiario') {
        const x = await tx.uma(
          `SELECT k.operadora_saude_id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
            WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
          [e.beneficiario, est],
        );
        operadora = inteiro(x?.['operadora_saude_id']);
        if (operadora === null) throw recusa('beneficiario-inexistente', 'Beneficiário não encontrado.');
      } else if (e.portal === 'contratante') {
        const x = await tx.uma(
          `SELECT operadora_saude_id FROM contrato_plano WHERE contratante_plano_id = ? AND estabelecimento_id = ?
              AND excluido_em IS NULL ORDER BY id LIMIT 1`,
          [e.contratante, est],
        );
        operadora = inteiro(x?.['operadora_saude_id']);
        if (operadora === null)
          throw recusa('contratante-sem-contrato', 'Contratante sem contrato no estabelecimento.');
      } else operadora = ops[0] ?? null;
      if (operadora === null || !ops.includes(operadora))
        throw recusa('operadora-desconhecida', 'Operadora não ligada ao estabelecimento.');
      const login = e.login.trim().toLowerCase();
      const [rep] = await tx.consultar(
        `SELECT id FROM ${tabela} WHERE operadora_saude_id = ? AND login = ? AND excluido_em IS NULL`,
        [operadora, login],
      );
      if (rep) throw recusa('login-em-uso', 'Já existe conta com esse acesso.', { campos: ['login'] });
      const id = await tx.incluir(tabela, {
        operadora_saude_id: operadora,
        ...(e.portal === 'beneficiario' ? { beneficiario_plano_id: e.beneficiario } : {}),
        ...(e.portal === 'contratante'
          ? { contratante_plano_id: e.contratante, gestor_pessoa_fisica_id: e.gestor }
          : {}),
        ...(e.portal === 'corretor'
          ? { corretora_venda_id: e.corretora ?? null, vendedor_plano_id: e.vendedor ?? null }
          : {}),
        usuario_id: e.usuario,
        login,
        email: e.email?.trim().toLowerCase() || (login.includes('@') ? login : null),
        telefone_celular: celularNormalizado(e.celular),
        situacao: 'convidada',
        convidada_em: new Date(),
      });
      return { id, versao: 1 };
    });
  }

  /** Ativar (aceite dos termos), bloquear (motivo), desbloquear (zera as tentativas) ou encerrar a conta. */
  mudarSituacaoConta(
    c: ContextoPorta,
    a: {
      readonly portal: TipoPortalOperadora;
      readonly id: number;
      readonly versao: number;
      readonly acao: AcaoContaPortal;
      readonly motivo: string | null;
      readonly termosAceitos: boolean;
    },
    trilha: Trilha,
  ): Promise<Gravado & { situacao: SituacaoContaPortal }> {
    const tabela = TABELA_CONTA[a.portal];
    return this.gravar(c, `operadora.portal-${a.portal}.conta.situacao`, tabela, trilha, async (tx, est) => {
      const ops = await this.operadorasDo(tx, est);
      const [x] = await tx.consultarParaAtualizar(
        `SELECT id, situacao, operadora_saude_id FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`,
        [a.id],
      );
      if (!x || !ops.includes(Number(x['operadora_saude_id'])))
        throw recusa('conta-inexistente', 'Conta não encontrada.');
      const r = proximaSituacaoContaPortal(textoObrigatorio(x['situacao']) as SituacaoContaPortal, a.acao, {
        motivo: a.motivo,
        termosAceitos: a.termosAceitos,
      });
      if ('problema' in r) throw recusaDe([r.problema]);
      const agora = new Date();
      const versao = await tx.alterar(tabela, a.id, a.versao, {
        situacao: r.situacao,
        ...(a.acao === 'ativar' ? { ativada_em: agora, termos_aceitos_em: agora } : {}),
        ...(a.acao === 'bloquear'
          ? { bloqueada_em: agora, motivo_bloqueio: (a.motivo ?? '').trim().slice(0, 200) }
          : {}),
        ...(a.acao === 'desbloquear' ? { tentativas_falhas: 0, motivo_bloqueio: null } : {}),
        ...(a.acao === 'encerrar' ? { encerrada_em: agora } : {}),
      });
      return { id: a.id, versao, situacao: r.situacao };
    });
  }

  // ── Solicitações ────────────────────────────────────────────────────────────────────────────────

  /** A fila da operadora ou só as da conta (portal), da mais nova; 100 no máximo. */
  solicitacoes(
    c: ContextoPorta,
    f: {
      readonly situacao?: SituacaoSolicitacaoPortal;
      readonly contaBeneficiario?: number;
      readonly contaContratante?: number;
    },
  ): Promise<SolicitacaoPortalLida[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let filtro = '';
      if (f.situacao) {
        filtro += ' AND s.situacao = ?';
        p.push(f.situacao);
      }
      if (f.contaBeneficiario !== undefined) {
        filtro += ' AND s.conta_portal_beneficiario_id = ?';
        p.push(f.contaBeneficiario);
      }
      if (f.contaContratante !== undefined) {
        filtro += ' AND s.conta_portal_contratante_id = ?';
        p.push(f.contaContratante);
      }
      const r = await l.consultar(`${SOLICITACAO_SQL}${filtro} ORDER BY s.id DESC LIMIT 100`, p);
      return r.map(solicitacaoDe);
    });
  }

  /** O beneficiário que a conta alcança: o próprio e os dependentes (beneficiário) ou os da contratante. */
  private async alcance(
    l: Pick<Leitor, 'uma'>,
    conta: ContaPortalLida,
    beneficiario: number | null,
    est: number,
  ): Promise<{
    situacao: 'ativo' | 'suspenso' | 'excluido';
    adesao: string | null;
    contrato: number;
  } | null> {
    if (beneficiario === null) return null;
    const x =
      conta.portal === 'beneficiario'
        ? await l.uma(
            `SELECT b.situacao, b.data_adesao, b.contrato_plano_id FROM beneficiario_plano b
               JOIN contrato_plano k ON k.id = b.contrato_plano_id
              WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL
                AND (b.id = ? OR b.titular_beneficiario_plano_id = ?)`,
            [beneficiario, est, conta.beneficiario, conta.beneficiario],
          )
        : await l.uma(
            `SELECT b.situacao, b.data_adesao, b.contrato_plano_id FROM beneficiario_plano b
               JOIN contrato_plano k ON k.id = b.contrato_plano_id
              WHERE b.id = ? AND k.estabelecimento_id = ? AND k.contratante_plano_id = ? AND b.excluido_em IS NULL`,
            [beneficiario, est, conta.contratante],
          );
    return x
      ? {
          situacao: textoObrigatorio(x['situacao']) as 'ativo' | 'suspenso' | 'excluido',
          adesao: dataIso(x['data_adesao']),
          contrato: Number(x['contrato_plano_id']),
        }
      : null;
  }

  /** A solicitação aberta pelo portal, sempre sobre o alcance da conta; o pedido de reembolso tem de ser do mesmo beneficiário. */
  abrirSolicitacao(
    c: ContextoPorta,
    conta: ContaPortalLida,
    e: Omit<SolicitacaoPortalEntrada, 'portal'>,
    trilha: Trilha,
  ): Promise<Gravado & { numero: string; aviso: string }> {
    return this.gravar(
      c,
      'operadora.portal.solicitacao.abrir',
      'solicitacao_portal_beneficiario',
      trilha,
      async (tx, est) => {
        const alvo = await this.alcance(tx, conta, e.beneficiario, est);
        const [rep] =
          e.beneficiario === null
            ? []
            : await tx.consultar(
                `SELECT id FROM solicitacao_portal_beneficiario WHERE estabelecimento_id = ? AND beneficiario_plano_id = ?
                    AND tipo_solicitacao = ? AND situacao IN ('aberta','em_analise','pendente_documento') AND excluido_em IS NULL`,
                [est, e.beneficiario, e.tipo],
              );
        const entrada: SolicitacaoPortalEntrada = { ...e, portal: conta.portal };
        const problemas = problemasDaSolicitacaoPortal(entrada, {
          hoje: await hojeDe(tx),
          situacaoBeneficiario: alvo?.situacao ?? null,
          adesao: alvo?.adesao ?? null,
          repetida: Boolean(rep),
        });
        if (e.tipo === 'reembolso' && e.pedidoReembolso !== null && !problemas.length) {
          const pr = await tx.uma(
            'SELECT id FROM pedido_reembolso WHERE id = ? AND beneficiario_plano_id = ? AND excluido_em IS NULL',
            [e.pedidoReembolso, e.beneficiario],
          );
          if (!pr) problemas.push({ codigo: 'reembolso-de-outro-beneficiario', campo: 'pedidoReembolso' });
        }
        if (problemas.length) throw recusaDe(problemas);
        const provisorio = `SP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
          0,
          30,
        );
        const id = await tx.incluir('solicitacao_portal_beneficiario', {
          estabelecimento_id: est,
          numero: provisorio,
          tipo_solicitacao: e.tipo,
          situacao: 'aberta',
          conta_portal_beneficiario_id: conta.portal === 'beneficiario' ? conta.id : null,
          conta_portal_contratante_id: conta.portal === 'contratante' ? conta.id : null,
          contrato_plano_id: alvo?.contrato ?? null,
          beneficiario_plano_id: e.beneficiario,
          motivo_movimento_cadastral_id: e.motivo,
          data_efeito: e.dataEfeito,
          dados_solicitados: e.dados ? JSON.stringify(e.dados) : null,
          pedido_reembolso_id: e.tipo === 'reembolso' ? e.pedidoReembolso : null,
          observacao: e.observacao?.trim() || null,
        });
        const numero = `SP${String(id).padStart(8, '0')}`;
        const versao = await tx.alterar('solicitacao_portal_beneficiario', id, 1, { numero });
        return { id, versao, numero, aviso: avisoDaSolicitacao(conta, 'aberta').motivo };
      },
    );
  }

  /** A decisão da operadora, ou o cancelamento pelo dono (`dono`: a conta tem de ser a da solicitação). */
  decidirSolicitacao(
    c: ContextoPorta,
    a: {
      readonly id: number;
      readonly versao: number;
      readonly acao: AcaoSolicitacaoPortal;
      readonly resultado: string | null;
      readonly analista: number | null;
      readonly dono?: { readonly portal: TipoPortalOperadora; readonly conta: number };
    },
    trilha: Trilha,
  ): Promise<Gravado & { situacao: SituacaoSolicitacaoPortal }> {
    return this.gravar(
      c,
      'operadora.portal.solicitacao.decidir',
      'solicitacao_portal_beneficiario',
      trilha,
      async (tx, est) => {
        const [x] = await tx.consultarParaAtualizar(
          `SELECT id, situacao, conta_portal_beneficiario_id, conta_portal_contratante_id
             FROM solicitacao_portal_beneficiario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [a.id, est],
        );
        const coluna =
          a.dono?.portal === 'contratante' ? 'conta_portal_contratante_id' : 'conta_portal_beneficiario_id';
        if (!x || (a.dono && inteiro(x[coluna]) !== a.dono.conta))
          throw recusa('solicitacao-inexistente', 'Solicitação não encontrada.');
        if (a.dono && a.acao !== 'cancelar')
          throw recusa('acao-do-portal', 'O portal só cancela a solicitação.');
        const r = proximaSituacaoSolicitacaoPortal(
          textoObrigatorio(x['situacao']) as SituacaoSolicitacaoPortal,
          a.acao,
          a.resultado,
        );
        if ('problema' in r) throw recusaDe([r.problema]);
        const versao = await tx.alterar('solicitacao_portal_beneficiario', a.id, a.versao, {
          situacao: r.situacao,
          ...(a.dono ? {} : { analisado_em: new Date(), analisado_por_usuario_id: a.analista }),
          ...(a.resultado?.trim() ? { resultado: a.resultado.trim().slice(0, 1000) } : {}),
        });
        return { id: a.id, versao, situacao: r.situacao };
      },
    );
  }

  // ── Exclusão em lote da contratante ─────────────────────────────────────────────────────────────

  lotes(c: ContextoPorta, contratante?: number): Promise<LoteContratanteLido[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT * FROM movimentacao_lote_contratante WHERE estabelecimento_id = ? AND excluido_em IS NULL
           ${contratante !== undefined ? 'AND contratante_plano_id = ?' : ''} ORDER BY id DESC LIMIT 100`,
        contratante !== undefined ? [est, contratante] : [est],
      );
      return r.map(loteDe);
    });
  }

  itensDoLote(c: ContextoPorta, lote: number, contratante?: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT i.sequencia, i.acao, i.matricula_contratante, i.nome, i.beneficiario_plano_id, i.situacao, i.critica,
                i.data_efeito, i.processado_em
           FROM movimentacao_lote_contratante_item i JOIN movimentacao_lote_contratante m ON m.id = i.movimentacao_lote_contratante_id
          WHERE m.id = ? AND m.estabelecimento_id = ? ${contratante !== undefined ? 'AND m.contratante_plano_id = ?' : ''}
            AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        contratante !== undefined ? [lote, est, contratante] : [lote, est],
      );
      return r.map((x) => ({
        sequencia: Number(x['sequencia']),
        matricula: texto(x['matricula_contratante']),
        nome: textoObrigatorio(x['nome']),
        beneficiario: inteiro(x['beneficiario_plano_id']),
        situacao: textoObrigatorio(x['situacao']),
        critica: texto(x['critica']),
        dataEfeito: dataIso(x['data_efeito']),
        processadoEm: instanteIso(x['processado_em']),
      }));
    });
  }

  /** O lote de exclusão recebido pelo portal da contratante, criticado linha a linha pelo domínio. */
  receberExclusaoLote(
    c: ContextoPorta,
    conta: ContaPortalLida,
    linhas: readonly LinhaExclusaoLote[],
    trilha: Trilha,
  ): Promise<Gravado & { numero: string; situacao: string; aceitos: number; rejeitados: number }> {
    if (conta.portal !== 'contratante' || conta.contratante === null)
      return Promise.reject(recusa('conta-nao-contratante', 'Só a conta da contratante envia lote.'));
    if (!linhas.length || linhas.length > 5000)
      return Promise.reject(
        recusa('lote-vazio', 'O lote tem de ter de 1 a 5.000 linhas.', { campos: ['linhas'] }),
      );
    return this.gravar(
      c,
      'operadora.portal-contratante.lote.receber',
      'movimentacao_lote_contratante',
      trilha,
      async (tx, est) => {
        const mats = [...new Set(linhas.map((x) => (x.matricula ?? '').trim()).filter(Boolean))];
        const doContratante: BeneficiarioDoLote[] = mats.length
          ? (
              await tx.consultar(
                `SELECT b.id, b.matricula, b.matricula_empresa, pf.nome, b.situacao, b.data_adesao, b.titular_beneficiario_plano_id
                   FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
                   JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
                  WHERE k.contratante_plano_id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL
                    AND (b.matricula IN (${marcadores(mats.length)}) OR b.matricula_empresa IN (${marcadores(mats.length)}))`,
                [conta.contratante, est, ...mats, ...mats],
              )
            ).flatMap((x) => {
              const base = {
                id: Number(x['id']),
                nome: textoObrigatorio(x['nome']),
                situacao: textoObrigatorio(x['situacao']) as BeneficiarioDoLote['situacao'],
                adesao: dataIso(x['data_adesao']) ?? '',
                titular: inteiro(x['titular_beneficiario_plano_id']),
              };
              const emp = texto(x['matricula_empresa']);
              return [
                { ...base, matricula: textoObrigatorio(x['matricula']) },
                ...(emp ? [{ ...base, matricula: emp }] : []),
              ];
            })
          : [];
        const r = criticarExclusaoLote(linhas, doContratante);
        const situacao = situacaoDoLoteCriticado(r.totais);
        const provisorio = `LC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
          0,
          30,
        );
        const id = await tx.incluir('movimentacao_lote_contratante', {
          estabelecimento_id: est,
          numero: provisorio,
          contratante_plano_id: conta.contratante,
          canal: 'portal',
          layout: 'padrao_operadora',
          recebido_em: new Date(),
          situacao,
          total_registros: r.totais.registros,
          total_aceitos: r.totais.aceitos,
          total_rejeitados: r.totais.rejeitados,
        });
        const porSeq = new Map(linhas.map((x) => [x.sequencia, x]));
        for (const x of r.linhas) {
          const o = porSeq.get(x.sequencia);
          await tx.incluir('movimentacao_lote_contratante_item', {
            movimentacao_lote_contratante_id: id,
            sequencia: x.sequencia,
            acao: 'exclusao',
            beneficiario_plano_id: x.beneficiario,
            matricula_contratante: x.matricula.slice(0, 30) || null,
            nome: x.nome.slice(0, 150),
            motivo_movimento_cadastral_id: o?.motivo ?? null,
            data_efeito: o?.dataEfeito && /^\d{4}-\d{2}-\d{2}$/.test(o.dataEfeito) ? o.dataEfeito : null,
            situacao: x.situacao,
            critica: x.critica,
          });
        }
        const numero = `LC${String(id).padStart(8, '0')}`;
        const versao = await tx.alterar('movimentacao_lote_contratante', id, 1, { numero });
        return { id, versao, numero, situacao, aceitos: r.totais.aceitos, rejeitados: r.totais.rejeitados };
      },
    );
  }

  /**
   * O processamento pela operadora: cada linha aceita exclui o beneficiário (situação, data e motivo) com a versão dele;
   * o que mudou desde a crítica (já excluído) vira rejeição da linha. Só o lote criticado é processado.
   */
  processarLote(
    c: ContextoPorta,
    a: { readonly id: number; readonly versao: number },
    trilha: Trilha,
  ): Promise<Gravado & { situacao: string; excluidos: number; rejeitados: number }> {
    return this.gravar(
      c,
      'operadora.portal-contratante.lote.processar',
      'movimentacao_lote_contratante',
      trilha,
      async (tx, est) => {
        const [m] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, total_rejeitados FROM movimentacao_lote_contratante WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [a.id, est],
        );
        if (!m) throw recusa('lote-inexistente', 'Lote não encontrado.');
        if (textoObrigatorio(m['situacao']) !== 'criticado')
          throw recusa('lote-nao-criticado', 'Só o lote criticado é processado.');
        const itens = await tx.consultarParaAtualizar(
          `SELECT i.id, i.versao, i.beneficiario_plano_id, i.motivo_movimento_cadastral_id, i.data_efeito,
                  b.versao AS versao_beneficiario, b.situacao AS situacao_beneficiario
             FROM movimentacao_lote_contratante_item i JOIN beneficiario_plano b ON b.id = i.beneficiario_plano_id
            WHERE i.movimentacao_lote_contratante_id = ? AND i.situacao = 'aceito' AND i.excluido_em IS NULL
            ORDER BY i.sequencia`,
          [a.id],
        );
        const agora = new Date();
        let excluidos = 0;
        let rejeitados = Number(m['total_rejeitados'] ?? 0);
        for (const i of itens) {
          if (textoObrigatorio(i['situacao_beneficiario']) === 'excluido') {
            rejeitados += 1;
            await tx.alterar('movimentacao_lote_contratante_item', Number(i['id']), Number(i['versao']), {
              situacao: 'rejeitado',
              critica: 'beneficiario-ja-excluido',
              processado_em: agora,
            });
            continue;
          }
          await tx.alterar(
            'beneficiario_plano',
            Number(i['beneficiario_plano_id']),
            Number(i['versao_beneficiario']),
            {
              situacao: 'excluido',
              data_exclusao: dataIso(i['data_efeito']),
              motivo_movimento_cadastral_id: inteiro(i['motivo_movimento_cadastral_id']),
            },
          );
          await tx.alterar('movimentacao_lote_contratante_item', Number(i['id']), Number(i['versao']), {
            processado_em: agora,
          });
          excluidos += 1;
        }
        const situacao = situacaoDoLoteProcessado({ aceitos: excluidos, rejeitados });
        const versao = await tx.alterar('movimentacao_lote_contratante', a.id, a.versao, {
          situacao,
          processado_em: agora,
          total_aceitos: excluidos,
          total_rejeitados: rejeitados,
        });
        return { id: a.id, versao, situacao, excluidos, rejeitados };
      },
    );
  }

  // ── Cartão digital ──────────────────────────────────────────────────────────────────────────────

  /** O cartão digital do beneficiário da conta (ou de um dependente dele). */
  cartaoDigital(
    c: ContextoPorta,
    conta: ContaPortalLida,
    beneficiario?: number,
  ): Promise<CartaoDigital | null> {
    if (conta.portal !== 'beneficiario' || conta.beneficiario === null) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const alvo = beneficiario ?? conta.beneficiario;
      const x = await l.uma(
        `SELECT b.matricula, COALESCE(b.nome_carteira, pf.nome) AS nome, b.via_cartao, b.situacao, b.inicio_vigencia,
                b.fim_vigencia, COALESCE(pc.nome_cartao, pc.nome_comercial) AS produto, o.registro_ans
           FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
           JOIN plano_comercializado pc ON pc.id = b.plano_comercializado_id
           LEFT JOIN operadora_saude o ON o.id = k.operadora_saude_id
          WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL
            AND (b.id = ? OR b.titular_beneficiario_plano_id = ?)`,
        [alvo, est, conta.beneficiario, conta.beneficiario],
      );
      if (!x) return null;
      const inicio = dataIso(x['inicio_vigencia']) ?? '';
      const fim = dataIso(x['fim_vigencia']);
      return {
        matricula: textoObrigatorio(x['matricula']),
        nome: textoObrigatorio(x['nome']),
        via: inteiro(x['via_cartao']) ?? 1,
        produto: textoObrigatorio(x['produto']),
        registroAns: texto(x['registro_ans']),
        inicioVigencia: inicio,
        fimVigencia: fim,
        valido: cartaoDigitalValido(
          { situacao: textoObrigatorio(x['situacao']), inicioVigencia: inicio, fimVigencia: fim },
          await hojeDe(l),
        ),
      };
    });
  }
}
