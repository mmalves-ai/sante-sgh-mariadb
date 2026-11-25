// Porta PRÓPRIA da manutenção corretiva (04-HOT L135) sobre o MariaDB do cliente: o cadastro da oficina
// (oficina_manutencao, com os serviços em oficina_manutencao_servico e as pessoas em oficina_manutencao_usuario, com a
// alçada do aprovador), o orçamento da OS (orcamento_ordem_servico_manutencao) e a remessa do equipamento para conserto
// externo (remessa_conserto_manutencao), com a mudança da OS e o evento no histórico na mesma transação.
// Gravações diretas numa operação do Executor (gravacaoDireta: trilha e idempotência na mesma transação); a OS, a
// oficina, o orçamento e a remessa são relidos e travados (FOR UPDATE) e conferidos pela versão vista. A regra vem do
// controlador como callback (a porta não importa o domínio). Nada se apaga: membro e serviço saem por `ativo = FALSE`
// com o fim da vigência; orçamento novo substitui o pendente; a remessa retornada fica no histórico da OS.
import {
  type ContextoNucleo,
  type Executor,
  type Leitor,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { NucleoManutencao } from './porta-propria.js';

export const TABELAS_OFICINA_ORCAMENTO = [
  'oficina_manutencao',
  'oficina_manutencao_servico',
  'oficina_manutencao_usuario',
  'orcamento_ordem_servico_manutencao',
  'remessa_conserto_manutencao',
  'ordem_servico_manutencao',
  'ordem_servico_manutencao_evento',
] as const;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined ? null : String(v));
const dia = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** Instante do banco (UTC) → "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
function instante(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
/** "AAAA-MM-DDTHH:MM" (no fuso do estabelecimento) → instante do banco. */
function paraInstante(v: string, fuso: string): Date {
  const hh = v.length >= 16 ? `${v.slice(11, 13)}${v.slice(14, 16)}` : '0000';
  return instanteCivil(v.slice(0, 10), hh, fuso);
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

// ── Tipos ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type FuncaoMembro = 'tecnico' | 'supervisor' | 'aprovador' | 'recepcao';

export interface MembroDaOficina {
  readonly id: number | null;
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly funcao: FuncaoMembro;
  readonly alcada: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface ServicoDaOficina {
  readonly servico: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tempoPadraoMinutos: number | null;
  readonly ativo: boolean;
}

export interface Oficina {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly terceirizada: boolean;
  readonly fornecedor: number | null;
  readonly fornecedorNome: string | null;
  readonly especialidade: number | null;
  readonly especialidadeNome: string | null;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ramal: string | null;
  readonly notificaPorEmail: boolean;
  readonly exigeAvaliacao: boolean;
  readonly ativo: boolean;
  readonly ordensAbertas: number;
}

export interface OficinaDetalhe extends Oficina {
  readonly membros: readonly MembroDaOficina[];
  readonly servicos: readonly ServicoDaOficina[];
}

export interface OficinaParaGravar {
  readonly codigo: string;
  readonly nome: string;
  readonly terceirizada: boolean;
  readonly fornecedor: number | null;
  readonly especialidade: number | null;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ramal: string | null;
  readonly notificaPorEmail: boolean;
  readonly exigeAvaliacao: boolean;
  readonly ativo: boolean;
  readonly membros: readonly {
    readonly login: string;
    readonly funcao: FuncaoMembro;
    readonly alcada: number | null;
    readonly vigenciaInicio: string;
    readonly vigenciaFim: string | null;
  }[];
  readonly servicos: readonly { readonly servico: number; readonly tempoPadraoMinutos: number | null }[];
}

export interface OpcaoSimples {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}

export type SituacaoOrcamentoBanco = 'pendente' | 'aprovado' | 'reprovado' | 'substituido';

export interface OrcamentoDaOs {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number | null;
  readonly fornecedorNome: string | null;
  readonly descricao: string;
  readonly valor: number;
  readonly prazoDias: number | null;
  readonly validade: string | null;
  readonly situacao: SituacaoOrcamentoBanco;
  readonly registradoPor: number;
  readonly registradoPorNome: string;
  readonly registradoEm: string;
  readonly decididoPorNome: string | null;
  readonly decididoEm: string | null;
  readonly justificativa: string | null;
}

export interface RemessaDaOs {
  readonly id: number;
  readonly versao: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly orcamento: number | null;
  readonly termoSaida: string;
  readonly notaFiscalRemessa: string | null;
  readonly cfop: '5915' | '6915' | null;
  readonly enviadoEm: string;
  readonly enviadoPorNome: string;
  readonly previsaoRetorno: string | null;
  readonly situacao: 'enviado' | 'retornado';
  readonly retornadoEm: string | null;
  readonly notaFiscalRetorno: string | null;
  readonly resultado: 'consertado' | 'sem_conserto' | null;
  readonly observacaoRetorno: string | null;
  readonly atrasada: boolean;
}

/** O que a OS mostra da corretiva externa: a oficina, os orçamentos e as remessas, com o que a pessoa pode fazer. */
export interface CorretivaExterna {
  readonly os: number;
  readonly versaoOs: number;
  readonly situacaoOs: string;
  readonly oficina: number | null;
  readonly oficinaNome: string | null;
  readonly equipamento: number | null;
  readonly orcamentos: readonly OrcamentoDaOs[];
  readonly remessas: readonly RemessaDaOs[];
}

/** O estado relido dentro da transação, para a regra do domínio decidir. */
export interface OsRelida {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly oficina: number | null;
  readonly equipamento: number | null;
}

type Contexto = ContextoNucleo & { readonly estabelecimento: number | null };

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────
const TABELA_OFICINA = 'oficina_manutencao';
const TABELA_MEMBRO = 'oficina_manutencao_usuario';
const TABELA_SERVICO = 'oficina_manutencao_servico';
const TABELA_ORCAMENTO = 'orcamento_ordem_servico_manutencao';
const TABELA_REMESSA = 'remessa_conserto_manutencao';
const TABELA_OS = 'ordem_servico_manutencao';
const TABELA_EVENTO = 'ordem_servico_manutencao_evento';

const SQL_OFICINAS = `
  SELECT o.id, o.versao, o.codigo, o.nome, o.terceirizada, o.empresa_fornecedora_id, f.razao_social AS fornecedor_nome,
         o.especialidade_manutencao_id, e.descricao AS especialidade_nome, o.email, o.telefone, o.ramal,
         o.notifica_por_email, o.exige_avaliacao_servico, o.ativo,
         (SELECT COUNT(*) FROM ordem_servico_manutencao s WHERE s.oficina_manutencao_id = o.id AND s.excluido_em IS NULL
            AND s.situacao IN ('aberta','em_atendimento','aguardando_peca','aguardando_terceiro')) AS abertas
    FROM oficina_manutencao o
    LEFT JOIN empresa_fornecedora f ON f.id = o.empresa_fornecedora_id
    LEFT JOIN especialidade_manutencao e ON e.id = o.especialidade_manutencao_id
   WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL`;

const oficinaDe = (x: Record<string, unknown>): Oficina => ({
  id: n(x['id']),
  versao: n(x['versao']),
  codigo: t(x['codigo']),
  nome: t(x['nome']),
  terceirizada: Boolean(n(x['terceirizada'])),
  fornecedor: nn(x['empresa_fornecedora_id']),
  fornecedorNome: tn(x['fornecedor_nome']),
  especialidade: nn(x['especialidade_manutencao_id']),
  especialidadeNome: tn(x['especialidade_nome']),
  email: tn(x['email']),
  telefone: tn(x['telefone']),
  ramal: tn(x['ramal']),
  notificaPorEmail: Boolean(n(x['notifica_por_email'])),
  exigeAvaliacao: Boolean(n(x['exige_avaliacao_servico'])),
  ativo: Boolean(n(x['ativo'])),
  ordensAbertas: n(x['abertas']),
});

async function lerMembros(l: Leitor, oficina: number): Promise<MembroDaOficina[]> {
  return (
    await l.consultar(
      `SELECT m.id, m.usuario_id, u.login, u.nome, m.funcao, m.alcada_aprovacao, m.vigencia_inicio, m.vigencia_fim, m.ativo
         FROM oficina_manutencao_usuario m JOIN usuario u ON u.id = m.usuario_id
        WHERE m.oficina_manutencao_id = ? AND m.excluido_em IS NULL ORDER BY m.ativo DESC, u.nome LIMIT 500`,
      [oficina],
    )
  ).map((x) => ({
    id: n(x['id']),
    usuario: n(x['usuario_id']),
    login: t(x['login']),
    nome: t(x['nome']),
    funcao: t(x['funcao']) as FuncaoMembro,
    alcada: x['alcada_aprovacao'] === null ? null : Number(x['alcada_aprovacao']),
    vigenciaInicio: dia(x['vigencia_inicio']) ?? '',
    vigenciaFim: dia(x['vigencia_fim']),
    ativo: Boolean(n(x['ativo'])),
  }));
}

async function lerServicos(l: Leitor, oficina: number): Promise<ServicoDaOficina[]> {
  return (
    await l.consultar(
      `SELECT os.servico_manutencao_id, s.codigo, s.nome, os.tempo_padrao_minutos, os.ativo
         FROM oficina_manutencao_servico os JOIN servico_manutencao s ON s.id = os.servico_manutencao_id
        WHERE os.oficina_manutencao_id = ? AND os.excluido_em IS NULL ORDER BY os.ativo DESC, s.nome LIMIT 500`,
      [oficina],
    )
  ).map((x) => ({
    servico: n(x['servico_manutencao_id']),
    codigo: t(x['codigo']),
    nome: t(x['nome']),
    tempoPadraoMinutos: nn(x['tempo_padrao_minutos']),
    ativo: Boolean(n(x['ativo'])),
  }));
}

async function lerCorretiva(
  l: Leitor,
  est: number,
  os: number,
  hoje: string,
  fuso: string,
): Promise<CorretivaExterna | null> {
  const o = await l.uma<Record<string, unknown>>(
    `SELECT s.id, s.versao, s.situacao, s.oficina_manutencao_id, f.nome AS oficina_nome, s.equipamento_saude_id
       FROM ordem_servico_manutencao s LEFT JOIN oficina_manutencao f ON f.id = s.oficina_manutencao_id
      WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
    [os, est],
  );
  if (!o) return null;
  const orcamentos = (
    await l.consultar(
      `SELECT c.*, f.razao_social AS fornecedor_nome, ur.nome AS registrado_nome, ud.nome AS decidido_nome
         FROM orcamento_ordem_servico_manutencao c
         LEFT JOIN empresa_fornecedora f ON f.id = c.empresa_fornecedora_id
         JOIN usuario ur ON ur.id = c.registrado_por_usuario_id
         LEFT JOIN usuario ud ON ud.id = c.decidido_por_usuario_id
        WHERE c.ordem_servico_manutencao_id = ? AND c.estabelecimento_id = ? ORDER BY c.id DESC LIMIT 100`,
      [os, est],
    )
  ).map((x): OrcamentoDaOs => ({
    id: n(x['id']),
    versao: n(x['versao']),
    fornecedor: nn(x['empresa_fornecedora_id']),
    fornecedorNome: tn(x['fornecedor_nome']),
    descricao: t(x['descricao']),
    valor: Number(x['valor']),
    prazoDias: nn(x['prazo_dias']),
    validade: dia(x['validade']),
    situacao: t(x['situacao']) as SituacaoOrcamentoBanco,
    registradoPor: n(x['registrado_por_usuario_id']),
    registradoPorNome: t(x['registrado_nome']),
    registradoEm: instante(x['registrado_em'], fuso) ?? '',
    decididoPorNome: tn(x['decidido_nome']),
    decididoEm: instante(x['decidido_em'], fuso),
    justificativa: tn(x['justificativa_decisao']),
  }));
  const remessas = (
    await l.consultar(
      `SELECT r.*, f.razao_social AS fornecedor_nome, ue.nome AS enviado_nome
         FROM remessa_conserto_manutencao r
         JOIN empresa_fornecedora f ON f.id = r.empresa_fornecedora_id
         JOIN usuario ue ON ue.id = r.enviado_por_usuario_id
        WHERE r.ordem_servico_manutencao_id = ? AND r.estabelecimento_id = ? ORDER BY r.id DESC LIMIT 100`,
      [os, est],
    )
  ).map((x): RemessaDaOs => {
    const previsao = dia(x['previsao_retorno']);
    const situacao = t(x['situacao']) as RemessaDaOs['situacao'];
    return {
      id: n(x['id']),
      versao: n(x['versao']),
      fornecedor: n(x['empresa_fornecedora_id']),
      fornecedorNome: t(x['fornecedor_nome']),
      orcamento: nn(x['orcamento_ordem_servico_manutencao_id']),
      termoSaida: t(x['termo_saida']),
      notaFiscalRemessa: tn(x['nota_fiscal_remessa']),
      cfop: tn(x['cfop_remessa']) as RemessaDaOs['cfop'],
      enviadoEm: instante(x['enviado_em'], fuso) ?? '',
      enviadoPorNome: t(x['enviado_nome']),
      previsaoRetorno: previsao,
      situacao,
      retornadoEm: instante(x['retornado_em'], fuso),
      notaFiscalRetorno: tn(x['nota_fiscal_retorno']),
      resultado: tn(x['resultado_retorno']) as RemessaDaOs['resultado'],
      observacaoRetorno: tn(x['observacao_retorno']),
      atrasada: situacao === 'enviado' && previsao !== null && previsao < hoje,
    };
  });
  return {
    os: n(o['id']),
    versaoOs: n(o['versao']),
    situacaoOs: camel(t(o['situacao'])),
    oficina: nn(o['oficina_manutencao_id']),
    oficinaNome: tn(o['oficina_nome']),
    equipamento: nn(o['equipamento_saude_id']),
    orcamentos,
    remessas,
  };
}

// ── Gravador ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanoOk {
  readonly ok: true;
  readonly para?: string;
}
export type Plano = PlanoOk | { readonly ok: false; readonly recusa: string; readonly mensagem: string };

const recusar = (p: Plano): void => {
  if (!p.ok) throw recusa(p.recusa, p.mensagem);
};

function gravador(tx: TxOperacao, est: number, c: Contexto) {
  const usuario = c.usuario;
  const fusoP = tx
    .uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est])
    .then((r) => r?.fuso_horario || FUSO_PADRAO);
  const agora = async () => {
    const r = relogioNoFuso(await fusoP);
    return { hoje: r.hoje, agora: `${r.hoje}T${r.hora}`, fuso: await fusoP };
  };

  const travarOs = async (os: number, versao: number | null): Promise<OsRelida> => {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, oficina_manutencao_id, equipamento_saude_id FROM ordem_servico_manutencao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [os, est],
    );
    if (!r) throw recusa('nao-encontrado', 'Ordem de serviço não encontrada.');
    if (versao !== null && n(r['versao']) !== versao)
      throw recusa('conflito-versao', 'A ordem de serviço mudou depois que você abriu. Abra de novo.');
    return {
      id: n(r['id']),
      versao: n(r['versao']),
      situacao: camel(t(r['situacao'])),
      oficina: nn(r['oficina_manutencao_id']),
      equipamento: nn(r['equipamento_saude_id']),
    };
  };
  const evento = (
    os: number,
    tipo: string,
    de: string | null,
    para: string | null,
    nota: string | null,
    em: Date,
  ) =>
    tx.incluir(TABELA_EVENTO, {
      ordem_servico_manutencao_id: os,
      tipo_evento: tipo,
      situacao_anterior: de ? snake(de) : null,
      situacao_nova: para ? snake(para) : null,
      nota: nota ? nota.slice(0, 2000) : null,
      ocorrido_em: em,
      usuario_id: usuario,
    });
  const mudarOs = async (o: OsRelida, para: string, tipo: string, nota: string | null, em: Date) => {
    const versao = await tx.alterar(TABELA_OS, o.id, o.versao, { situacao: snake(para) });
    await evento(o.id, tipo, o.situacao, para, nota, em);
    return versao;
  };
  const fornecedorValido = async (id: number | null): Promise<number | null> => {
    if (id === null) return null;
    const r = await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL', [id]);
    if (!r) throw recusa('fornecedor-invalido', 'Fornecedor não encontrado.');
    return id;
  };

  return {
    agora,

    async gravarOficina(
      id: number | null,
      versao: number | null,
      x: OficinaParaGravar,
      conferir: (
        membros: readonly {
          funcao: FuncaoMembro;
          alcada: number | null;
          vigenciaInicio: string;
          vigenciaFim: string | null;
        }[],
      ) => Plano,
    ): Promise<{ id: number; versao: number }> {
      recusar(conferir(x.membros));
      const valores = {
        codigo: x.codigo.trim().toUpperCase(),
        nome: x.nome.trim(),
        terceirizada: x.terceirizada,
        empresa_fornecedora_id: x.terceirizada ? await fornecedorValido(x.fornecedor) : null,
        especialidade_manutencao_id: x.especialidade,
        email: x.email?.trim() || null,
        telefone: x.telefone?.trim() || null,
        ramal: x.ramal?.trim() || null,
        notifica_por_email: x.notificaPorEmail,
        exige_avaliacao_servico: x.exigeAvaliacao,
        ativo: x.ativo,
      };
      if (
        x.especialidade !== null &&
        !(await tx.uma('SELECT id FROM especialidade_manutencao WHERE id = ?', [x.especialidade]))
      )
        throw recusa('especialidade-invalida', 'Especialidade não encontrada.');
      let oficina: number;
      let nova: number;
      try {
        if (id === null) {
          oficina = await tx.incluir(TABELA_OFICINA, { estabelecimento_id: est, ...valores });
          nova = 1;
        } else {
          const [r] = await tx.consultarParaAtualizar(
            'SELECT id, versao, ativo FROM oficina_manutencao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [id, est],
          );
          if (!r) throw recusa('nao-encontrado', 'Oficina não encontrada.');
          if (!x.ativo && Boolean(n(r['ativo']))) {
            const abertas = await tx.uma<{ q: number }>(
              `SELECT COUNT(*) AS q FROM ordem_servico_manutencao WHERE oficina_manutencao_id = ? AND excluido_em IS NULL
                 AND situacao IN ('aberta','em_atendimento','aguardando_peca','aguardando_terceiro')`,
              [id],
            );
            if (n(abertas?.q) > 0)
              throw recusa(
                'oficina-com-os-aberta',
                `A oficina tem ${n(abertas?.q)} ordem(ns) de serviço aberta(s).`,
              );
          }
          oficina = id;
          nova = await tx.alterar(TABELA_OFICINA, id, versao ?? -1, valores);
        }
      } catch (e) {
        if (restricaoUnicaViolada(e)) throw recusa('codigo-repetido', 'Já existe oficina com este código.');
        throw e;
      }
      // Pessoas: chave (usuário, função). As que saíram ficam inativas, com o fim da vigência.
      const { hoje } = await agora();
      const atuais = await tx.consultarParaAtualizar(
        'SELECT id, versao, usuario_id, funcao, ativo FROM oficina_manutencao_usuario WHERE oficina_manutencao_id = ? AND excluido_em IS NULL',
        [oficina],
      );
      const vistos = new Set<number>();
      for (const m of x.membros) {
        const u = await tx.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [m.login.trim()]);
        if (!u) throw recusa('usuario-invalido', `Usuário ${m.login.trim()} não encontrado.`);
        const ja = atuais.find((a) => n(a['usuario_id']) === n(u.id) && t(a['funcao']) === m.funcao);
        const v = {
          alcada_aprovacao: m.funcao === 'aprovador' ? m.alcada : null,
          vigencia_inicio: m.vigenciaInicio,
          vigencia_fim: m.vigenciaFim,
          ativo: true,
        };
        if (ja) {
          vistos.add(n(ja['id']));
          await tx.alterar(TABELA_MEMBRO, n(ja['id']), n(ja['versao']), v);
        } else {
          await tx.incluir(TABELA_MEMBRO, {
            oficina_manutencao_id: oficina,
            usuario_id: n(u.id),
            funcao: m.funcao,
            ...v,
          });
        }
      }
      for (const a of atuais)
        if (!vistos.has(n(a['id'])) && Boolean(n(a['ativo'])))
          await tx.alterar(TABELA_MEMBRO, n(a['id']), n(a['versao']), { ativo: false, vigencia_fim: hoje });
      // Serviços que a oficina atende.
      const servAtuais = await tx.consultarParaAtualizar(
        'SELECT id, versao, servico_manutencao_id, ativo FROM oficina_manutencao_servico WHERE oficina_manutencao_id = ? AND excluido_em IS NULL',
        [oficina],
      );
      const servVistos = new Set<number>();
      for (const s of x.servicos) {
        if (!(await tx.uma('SELECT id FROM servico_manutencao WHERE id = ?', [s.servico])))
          throw recusa('servico-invalido', 'Serviço de manutenção não encontrado.');
        const ja = servAtuais.find((a) => n(a['servico_manutencao_id']) === s.servico);
        if (ja) {
          servVistos.add(n(ja['id']));
          await tx.alterar(TABELA_SERVICO, n(ja['id']), n(ja['versao']), {
            tempo_padrao_minutos: s.tempoPadraoMinutos,
            ativo: true,
          });
        } else
          await tx.incluir(TABELA_SERVICO, {
            oficina_manutencao_id: oficina,
            servico_manutencao_id: s.servico,
            tempo_padrao_minutos: s.tempoPadraoMinutos,
          });
      }
      for (const a of servAtuais)
        if (!servVistos.has(n(a['id'])) && Boolean(n(a['ativo'])))
          await tx.alterar(TABELA_SERVICO, n(a['id']), n(a['versao']), { ativo: false });
      return { id: oficina, versao: nova };
    },

    /** Orçamento novo na OS; o pendente anterior passa a substituído. */
    async registrarOrcamento(
      x: {
        os: number;
        versaoOs: number;
        fornecedor: number | null;
        descricao: string;
        valor: number;
        prazoDias: number | null;
        validade: string | null;
      },
      planejar: (o: OsRelida, haAprovado: boolean, hoje: string) => Plano,
    ): Promise<{ id: number; os: number }> {
      const o = await travarOs(x.os, x.versaoOs);
      const anteriores = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM orcamento_ordem_servico_manutencao WHERE ordem_servico_manutencao_id = ? AND estabelecimento_id = ?',
        [o.id, est],
      );
      const { hoje, agora: ag, fuso } = await agora();
      recusar(
        planejar(
          o,
          anteriores.some((a) => t(a['situacao']) === 'aprovado'),
          hoje,
        ),
      );
      for (const a of anteriores)
        if (t(a['situacao']) === 'pendente')
          await tx.alterar(TABELA_ORCAMENTO, n(a['id']), n(a['versao']), { situacao: 'substituido' });
      const id = await tx.incluir(TABELA_ORCAMENTO, {
        estabelecimento_id: est,
        ordem_servico_manutencao_id: o.id,
        empresa_fornecedora_id: await fornecedorValido(x.fornecedor),
        descricao: x.descricao.trim().slice(0, 1000),
        valor: x.valor.toFixed(2),
        prazo_dias: x.prazoDias,
        validade: x.validade,
        situacao: 'pendente',
        registrado_por_usuario_id: usuario,
        registrado_em: paraInstante(ag, fuso),
      });
      return { id, os: o.id };
    },

    /** Aprovação ou reprovação do orçamento, com o evento na OS. */
    async decidirOrcamento(
      x: {
        orcamento: number;
        versao: number;
        decisao: 'aprovado' | 'reprovado';
        justificativa: string | null;
      },
      planejar: (
        orc: {
          situacao: SituacaoOrcamentoBanco;
          valor: number;
          registradoPor: number;
          validade: string | null;
        },
        membros: readonly MembroDaOficina[],
        hoje: string,
      ) => Plano,
    ): Promise<{ id: number; os: number; versao: number }> {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, versao, ordem_servico_manutencao_id, situacao, valor, registrado_por_usuario_id, validade FROM orcamento_ordem_servico_manutencao WHERE id = ? AND estabelecimento_id = ?',
        [x.orcamento, est],
      );
      if (!r) throw recusa('nao-encontrado', 'Orçamento não encontrado.');
      if (n(r['versao']) !== x.versao)
        throw recusa('conflito-versao', 'O orçamento mudou depois que você abriu.');
      const o = await travarOs(n(r['ordem_servico_manutencao_id']), null);
      const membros = o.oficina === null ? [] : await lerMembros(tx, o.oficina);
      const { hoje, agora: ag, fuso } = await agora();
      recusar(
        planejar(
          {
            situacao: t(r['situacao']) as SituacaoOrcamentoBanco,
            valor: Number(r['valor']),
            registradoPor: n(r['registrado_por_usuario_id']),
            validade: dia(r['validade']),
          },
          membros.filter((m) => m.usuario === usuario),
          hoje,
        ),
      );
      const em = paraInstante(ag, fuso);
      const versao = await tx.alterar(TABELA_ORCAMENTO, x.orcamento, x.versao, {
        situacao: x.decisao,
        decidido_por_usuario_id: usuario,
        decidido_em: em,
        justificativa_decisao: x.justificativa?.trim() || null,
      });
      await evento(
        o.id,
        x.decisao === 'aprovado' ? 'orcamento_aprovado' : 'orcamento_reprovado',
        null,
        null,
        `Orçamento de R$ ${Number(r['valor']).toFixed(2)}${x.justificativa ? `: ${x.justificativa.trim()}` : ''}`,
        em,
      );
      return { id: x.orcamento, os: o.id, versao };
    },

    /** A saída do equipamento ao fornecedor: a remessa e a OS aguardando o fornecedor. */
    async enviarRemessa(
      x: {
        os: number;
        versaoOs: number;
        fornecedor: number;
        termo: string;
        notaFiscal: string | null;
        cfop: '5915' | '6915' | null;
        previsaoRetorno: string | null;
      },
      planejar: (
        o: OsRelida,
        remessaAberta: boolean,
        orcamento: SituacaoOrcamentoBanco | null,
        agora: string,
      ) => Plano,
    ): Promise<{ id: number; os: number; versaoOs: number }> {
      const o = await travarOs(x.os, x.versaoOs);
      const [aberta] = await tx.consultarParaAtualizar(
        "SELECT id FROM remessa_conserto_manutencao WHERE ordem_servico_manutencao_id = ? AND situacao = 'enviado'",
        [o.id],
      );
      const ultimo = await tx.uma<{ id: number; situacao: string }>(
        "SELECT id, situacao FROM orcamento_ordem_servico_manutencao WHERE ordem_servico_manutencao_id = ? AND situacao <> 'substituido' ORDER BY id DESC LIMIT 1",
        [o.id],
      );
      const { agora: ag, fuso } = await agora();
      const plano = planejar(o, Boolean(aberta), (ultimo?.situacao as SituacaoOrcamentoBanco) ?? null, ag);
      recusar(plano);
      const em = paraInstante(ag, fuso);
      const id = await tx.incluir(TABELA_REMESSA, {
        estabelecimento_id: est,
        ordem_servico_manutencao_id: o.id,
        equipamento_saude_id: o.equipamento,
        empresa_fornecedora_id: await fornecedorValido(x.fornecedor),
        orcamento_ordem_servico_manutencao_id: ultimo?.situacao === 'aprovado' ? n(ultimo.id) : null,
        termo_saida: x.termo.trim().slice(0, 1000),
        nota_fiscal_remessa: x.notaFiscal?.trim() || null,
        cfop_remessa: x.cfop,
        enviado_em: em,
        enviado_por_usuario_id: usuario,
        previsao_retorno: x.previsaoRetorno,
        situacao: 'enviado',
      });
      const versaoOs = await mudarOs(
        o,
        (plano as PlanoOk).para ?? 'aguardandoTerceiro',
        'envio_externo',
        x.termo.trim(),
        em,
      );
      return { id, os: o.id, versaoOs };
    },

    /** O retorno do fornecedor: fecha a remessa e devolve a OS ao atendimento. */
    async registrarRetorno(
      x: {
        remessa: number;
        versao: number;
        retornadoEm: string | null;
        notaFiscal: string | null;
        resultado: 'consertado' | 'sem_conserto';
        observacao: string | null;
      },
      planejar: (
        r: { situacao: 'enviado' | 'retornado'; enviadoEm: string },
        retornadoEm: string,
        agora: string,
      ) => Plano,
    ): Promise<{ id: number; os: number; versaoOs: number }> {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, versao, ordem_servico_manutencao_id, situacao, enviado_em FROM remessa_conserto_manutencao WHERE id = ? AND estabelecimento_id = ?',
        [x.remessa, est],
      );
      if (!r) throw recusa('nao-encontrado', 'Remessa não encontrada.');
      if (n(r['versao']) !== x.versao)
        throw recusa('conflito-versao', 'A remessa mudou depois que você abriu.');
      const o = await travarOs(n(r['ordem_servico_manutencao_id']), null);
      const { agora: ag, fuso } = await agora();
      const retorno = x.retornadoEm ?? ag;
      const plano = planejar(
        {
          situacao: t(r['situacao']) as 'enviado' | 'retornado',
          enviadoEm: instante(r['enviado_em'], fuso) ?? '',
        },
        retorno,
        ag,
      );
      recusar(plano);
      const em = paraInstante(retorno, fuso);
      await tx.alterar(TABELA_REMESSA, x.remessa, x.versao, {
        situacao: 'retornado',
        retornado_em: em,
        retornado_por_usuario_id: usuario,
        nota_fiscal_retorno: x.notaFiscal?.trim() || null,
        resultado_retorno: x.resultado,
        observacao_retorno: x.observacao?.trim() || null,
      });
      const nota =
        x.resultado === 'consertado'
          ? 'Retornou consertado'
          : `Retornou sem conserto: ${x.observacao?.trim() ?? ''}`;
      const versaoOs =
        o.situacao === 'aguardandoTerceiro'
          ? await mudarOs(o, (plano as PlanoOk).para ?? 'emAtendimento', 'retorno_externo', nota, em)
          : (await evento(o.id, 'retorno_externo', null, null, nota, em), o.versao);
      return { id: x.remessa, os: o.id, versaoOs };
    },
  };
}

export type GravadorOficinaOrcamento = ReturnType<typeof gravador>;

// ── A porta ────────────────────────────────────────────────────────────────────────────────────────────────────
export class PortaOficinaOrcamentoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoManutencao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(
    c: Contexto,
    fn: (l: Leitor, est: number, relogio: () => Promise<{ hoje: string; fuso: string }>) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: c.cliente, estabelecimento: est, usuario: c.usuario, correlacao: c.correlacao.slice(0, 64) },
      (l) =>
        fn(l, est, async () => {
          const f = await l.uma<{ fuso_horario: string | null }>(
            'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
            [est],
          );
          const fuso = f?.fuso_horario || FUSO_PADRAO;
          return { hoje: relogioNoFuso(fuso).hoje, fuso };
        }),
    );
  }

  gravar<T>(
    c: Contexto,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorOficinaOrcamento) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'manutencao.corretiva-externa',
      tabelas: TABELAS_OFICINA_ORCAMENTO,
      trilha,
      gravador: (tx, est) => gravador(tx, est, c),
      fn,
    });
  }

  oficinas(c: Contexto, termo: string | null, inativas: boolean): Promise<Oficina[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let sql = SQL_OFICINAS;
      if (!inativas) sql += ' AND o.ativo';
      if (termo?.trim()) {
        sql += ' AND (o.codigo LIKE ? OR o.nome LIKE ?)';
        const k = `%${termo.trim().slice(0, 60)}%`;
        p.push(k, k);
      }
      return (await l.consultar(`${sql} ORDER BY o.ativo DESC, o.nome LIMIT 300`, p)).map(oficinaDe);
    });
  }

  oficina(c: Contexto, id: number): Promise<OficinaDetalhe | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Record<string, unknown>>(`${SQL_OFICINAS} AND o.id = ?`, [est, id]);
      if (!r) return null;
      return { ...oficinaDe(r), membros: await lerMembros(l, id), servicos: await lerServicos(l, id) };
    });
  }

  /** As opções do formulário: especialidades e serviços de manutenção ativos. */
  opcoes(c: Contexto): Promise<{ especialidades: OpcaoSimples[]; servicos: OpcaoSimples[] }> {
    return this.ler(c, async (l) => {
      const especialidades = (
        await l.consultar(
          'SELECT id, codigo, descricao FROM especialidade_manutencao WHERE ativo ORDER BY descricao LIMIT 300',
          [],
        )
      ).map((x) => ({ id: n(x['id']), codigo: t(x['codigo']), nome: t(x['descricao']) }));
      const servicos = (
        await l.consultar(
          'SELECT id, codigo, nome FROM servico_manutencao WHERE ativo ORDER BY nome LIMIT 500',
          [],
        )
      ).map((x) => ({ id: n(x['id']), codigo: t(x['codigo']), nome: t(x['nome']) }));
      return { especialidades, servicos };
    });
  }

  corretiva(c: Contexto, os: number): Promise<CorretivaExterna | null> {
    return this.ler(c, async (l, est, relogio) => {
      const r = await relogio();
      return lerCorretiva(l, est, os, r.hoje, r.fuso);
    });
  }

  /** As remessas em aberto do estabelecimento (painel do que está fora), as atrasadas primeiro. */
  remessasAbertas(c: Contexto): Promise<
    {
      os: number;
      numero: string;
      equipamento: string;
      fornecedor: string;
      enviadoEm: string;
      previsaoRetorno: string | null;
      atrasada: boolean;
    }[]
  > {
    return this.ler(c, async (l, est, relogio) => {
      const { hoje: h, fuso } = await relogio();
      return (
        await l.consultar(
          `SELECT r.ordem_servico_manutencao_id, s.numero, e.nome AS equipamento, f.razao_social, r.enviado_em, r.previsao_retorno
             FROM remessa_conserto_manutencao r
             JOIN ordem_servico_manutencao s ON s.id = r.ordem_servico_manutencao_id
             JOIN equipamento_saude e ON e.id = r.equipamento_saude_id
             JOIN empresa_fornecedora f ON f.id = r.empresa_fornecedora_id
            WHERE r.estabelecimento_id = ? AND r.situacao = 'enviado'
            ORDER BY r.previsao_retorno IS NULL, r.previsao_retorno LIMIT 300`,
          [est],
        )
      ).map((x) => {
        const previsao = dia(x['previsao_retorno']);
        return {
          os: n(x['ordem_servico_manutencao_id']),
          numero: t(x['numero']),
          equipamento: t(x['equipamento']),
          fornecedor: t(x['razao_social']),
          enviadoEm: instante(x['enviado_em'], fuso) ?? '',
          previsaoRetorno: previsao,
          atrasada: previsao !== null && previsao < h,
        };
      });
    });
  }
}
