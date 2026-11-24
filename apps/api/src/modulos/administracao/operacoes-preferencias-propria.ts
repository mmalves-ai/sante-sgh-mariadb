// Preferências do usuário no banco próprio (01-ADM L84), pelo Executor (trilha, saída e idempotência na mesma
// transação). A preferência é sempre a da própria conta da sessão (nunca de outra pessoa) e segue o usuário em
// qualquer computador:
// - preferencias.gravarGeral: tema, densidade, texto ampliado (zoom), tela inicial do menu, filtro inicial de
//   atendimento e alerta em janela, numa linha por usuário (criada na primeira gravação, depois alterada);
// - preferencias.gravarVisaoTela: a visão salva de uma tela (colunas na ordem, ordenação, filtros, itens por
//   página), por nome; marcar uma como padrão tira a marca das outras da mesma tela (nada é apagado).
// As regras ficam em `@sgh/dominio-acesso` (preferencias/preferencias-usuario.ts).
import {
  conferirTelaInicial,
  conferirVisaoTela,
  MENSAGEM_PREFERENCIA,
  normalizarPreferenciaGeral,
  PREFERENCIA_GERAL_PADRAO,
  textoAmpliado,
  visaoInicial,
  type DensidadePreferida,
  type PreferenciaGeralNormalizada,
  type RecusaPreferencia,
  type TemaPreferido,
  type TipoAtendimentoPreferido,
} from '@sgh/dominio-acesso';
import { definirOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => v === true || num(v) === 1;
const vazio = (v: unknown): boolean => v === null || v === undefined;
const recusar = (r: RecusaPreferencia) => recusa(r, MENSAGEM_PREFERENCIA[r]);
const codigoTela = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9._-]+$/);
const json = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export const esquemaGravarPreferenciaGeral = z
  .object({
    tema: z.string().max(30).optional(),
    densidade: z.string().max(30).optional(),
    textoAmpliado: z.boolean().optional(),
    zoomPercentual: z.number().nullable().optional(),
    tipoAtendimentoPadrao: z.string().max(30).nullable().optional(),
    alertaJanelaSuspensa: z.boolean().optional(),
    /** Código da tela do menu aberta após o login; nulo volta à página inicial do perfil. */
    telaInicial: codigoTela.nullable().optional(),
  })
  .strict();

export const esquemaGravarVisaoTela = z
  .object({
    tela: codigoTela,
    nome: z.string().max(100).optional(),
    colunas: z.array(z.string().max(60)).max(60),
    ordenacao: z
      .array(z.object({ coluna: z.string().max(60), direcao: z.enum(['asc', 'desc']) }).strict())
      .max(10)
      .optional(),
    filtros: z.record(z.string().max(60), z.unknown()).optional(),
    itensPorPagina: z.number().int().nullable().optional(),
    padrao: z.boolean().optional(),
  })
  .strict();

function geralDaLinha(x: Record<string, unknown> | null): PreferenciaGeralNormalizada {
  if (!x) return PREFERENCIA_GERAL_PADRAO;
  const zoom = x['zoom_percentual'];
  return {
    tema: String(x['tema']) as TemaPreferido,
    densidade: String(x['densidade']) as DensidadePreferida,
    zoomPercentual: vazio(zoom) ? null : num(zoom),
    tipoAtendimentoPadrao: (x['tipo_atendimento_padrao'] ?? null) as TipoAtendimentoPreferido | null,
    alertaJanelaSuspensa: bool(x['alerta_janela_suspensa']),
  };
}

function usuarioDaSessao(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null || u === undefined) throw recusar('sem-conta');
  return u;
}

async function telaPorCodigo(tx: TxOperacao, codigo: string) {
  return tx.uma('SELECT id, ativo, rota, avulsa FROM tela_sistema WHERE codigo = ?', [codigo]);
}

const operacaoGravarGeral = definirOperacao({
  nome: 'preferencias.gravar_geral',
  tabelas: ['preferencia_usuario'],
  entrada: esquemaGravarPreferenciaGeral,
  async gravar(tx, e) {
    const usuario = usuarioDaSessao(tx);
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao, tema, densidade, zoom_percentual, tipo_atendimento_padrao, alerta_janela_suspensa,
              tela_inicial_id FROM preferencia_usuario WHERE usuario_id = ?`,
      [usuario],
    );
    const r = normalizarPreferenciaGeral(geralDaLinha(atual ?? null), e);
    if ('recusa' in r) throw recusar(r.recusa);
    let telaInicial: number | null =
      !atual || vazio(atual['tela_inicial_id']) ? null : num(atual['tela_inicial_id']);
    if (e.telaInicial !== undefined) {
      if (e.telaInicial === null) telaInicial = null;
      else {
        const t = await telaPorCodigo(tx, e.telaInicial);
        const recusaTela = conferirTelaInicial(
          t
            ? {
                ativa: bool(t['ativo']),
                rota: (t['rota'] as string | null) ?? null,
                avulsa: bool(t['avulsa']),
              }
            : null,
        );
        if (recusaTela) throw recusar(recusaTela);
        telaInicial = num(t!['id']);
      }
    }
    const p = r.preferencia;
    const valores = {
      tema: p.tema,
      densidade: p.densidade,
      zoom_percentual: p.zoomPercentual,
      tipo_atendimento_padrao: p.tipoAtendimentoPadrao,
      alerta_janela_suspensa: p.alertaJanelaSuspensa,
      tela_inicial_id: telaInicial,
    };
    let id: number;
    if (atual) {
      id = num(atual['id']);
      await tx.alterar('preferencia_usuario', id, num(atual['versao']), valores);
    } else id = await tx.incluir('preferencia_usuario', { usuario_id: usuario, ...valores });
    return { id, criada: !atual, ...p, textoAmpliado: textoAmpliado(p.zoomPercentual), telaInicial };
  },
  alvo: (_e, r) => ({ tabela: 'preferencia_usuario', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'preferencia.geral.gravada', carga: { id: r.id } }],
  trilha: (_e, r) => ({ dados: { criada: r.criada, tema: r.tema, densidade: r.densidade } }),
});

const operacaoGravarVisaoTela = definirOperacao({
  nome: 'preferencias.gravar_visao_tela',
  tabelas: ['preferencia_tela_usuario'],
  entrada: esquemaGravarVisaoTela,
  async gravar(tx, e) {
    const usuario = usuarioDaSessao(tx);
    const t = await telaPorCodigo(tx, e.tela);
    if (!t || !bool(t['ativo'])) throw recusar('tela-inexistente');
    const tela = num(t['id']);
    const daTela = await tx.consultarParaAtualizar(
      'SELECT id, versao, nome, padrao FROM preferencia_tela_usuario WHERE usuario_id = ? AND tela_sistema_id = ?',
      [usuario, tela],
    );
    const r = conferirVisaoTela(e, { primeiraDaTela: daTela.length === 0 });
    if ('recusa' in r) throw recusar(r.recusa);
    const v = r.visao;
    const valores = {
      colunas_visiveis: JSON.stringify(v.colunas),
      ordenacao: JSON.stringify(v.ordenacao),
      filtros: e.filtros === undefined ? null : JSON.stringify(e.filtros),
      itens_por_pagina: v.itensPorPagina,
      padrao: v.padrao,
    };
    let id: number | null = null;
    for (const a of daTela) {
      if (String(a['nome']) === v.nome) {
        id = num(a['id']);
        await tx.alterar('preferencia_tela_usuario', id, num(a['versao']), valores);
      } else if (v.padrao && bool(a['padrao']))
        await tx.alterar('preferencia_tela_usuario', num(a['id']), num(a['versao']), { padrao: false });
    }
    const criada = id === null;
    id ??= await tx.incluir('preferencia_tela_usuario', {
      usuario_id: usuario,
      tela_sistema_id: tela,
      nome: v.nome,
      ...valores,
    });
    return { id, criada, nome: v.nome, padrao: v.padrao };
  },
  alvo: (_e, r) => ({ tabela: 'preferencia_tela_usuario', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'preferencia.visao.gravada', carga: { id: r.id } }],
  trilha: (e, r) => ({
    dados: { tela: e.tela, criada: r.criada, padrao: r.padrao, colunas: e.colunas.length },
  }),
});

/** Receitas das preferências ligadas no banco próprio (o mapa OPERACOES da fonte própria as soma). */
export const OPERACOES_PREFERENCIAS_PROPRIA = {
  'preferencias.gravarGeral': operacaoGravarGeral,
  'preferencias.gravarVisaoTela': operacaoGravarVisaoTela,
} as const;

export const NOMES_OPERACOES_PREFERENCIAS_PROPRIA = Object.keys(OPERACOES_PREFERENCIAS_PROPRIA);

interface LeitorPreferencias {
  uma(sql: string, p: unknown[]): Promise<Record<string, unknown> | null | undefined>;
  consultar(sql: string, p: unknown[], o?: { teto?: number }): Promise<Record<string, unknown>[]>;
}

export interface VisaoTelaLida {
  readonly tela: string;
  readonly nome: string;
  readonly colunas: string[];
  readonly ordenacao: { coluna: string; direcao: 'asc' | 'desc' }[];
  readonly filtros: Record<string, unknown> | null;
  readonly itensPorPagina: number | null;
  readonly padrao: boolean;
}

export interface PreferenciasLidas {
  readonly guardadas: boolean;
  readonly geral: PreferenciaGeralNormalizada & { textoAmpliado: boolean };
  readonly telaInicial: { codigo: string; titulo: string; rota: string } | null;
  /** Telas do menu que podem ser a inicial (ativas, com endereço e não avulsas). */
  readonly telasDoMenu: { codigo: string; titulo: string; rota: string }[];
  readonly visoes: VisaoTelaLida[];
  /** Por tela, o nome da visão que a tela abre. */
  readonly visaoInicialPorTela: Record<string, string>;
}

/** Lê as preferências da conta (sem conta: as de fábrica, nada guardado). `tela` filtra as visões. */
export async function lerPreferenciasDoUsuario(
  l: LeitorPreferencias,
  usuario: number | null,
  tela?: string,
): Promise<PreferenciasLidas> {
  const telasDoMenu = (
    await l.consultar(
      'SELECT codigo, titulo, rota FROM tela_sistema WHERE ativo AND NOT avulsa AND rota IS NOT NULL ORDER BY titulo',
      [],
      { teto: 5000 },
    )
  ).map((x) => ({ codigo: String(x['codigo']), titulo: String(x['titulo']), rota: String(x['rota']) }));
  const linha =
    usuario === null
      ? null
      : await l.uma(
          `SELECT p.*, t.codigo AS tela_codigo, t.titulo AS tela_titulo, t.rota AS tela_rota
       FROM preferencia_usuario p LEFT JOIN tela_sistema t ON t.id = p.tela_inicial_id WHERE p.usuario_id = ?`,
          [usuario],
        );
  const geral = geralDaLinha(linha ?? null);
  const visoes: VisaoTelaLida[] =
    usuario === null
      ? []
      : (
          await l.consultar(
            `SELECT t.codigo AS tela, v.nome, v.colunas_visiveis, v.ordenacao, v.filtros, v.itens_por_pagina, v.padrao
               FROM preferencia_tela_usuario v JOIN tela_sistema t ON t.id = v.tela_sistema_id
              WHERE v.usuario_id = ? ${tela ? 'AND t.codigo = ?' : ''} ORDER BY t.codigo, v.nome`,
            tela ? [usuario, tela] : [usuario],
            { teto: 2000 },
          )
        ).map((x) => ({
          tela: String(x['tela']),
          nome: String(x['nome']),
          colunas: (json(x['colunas_visiveis']) as string[] | null) ?? [],
          ordenacao: (json(x['ordenacao']) as VisaoTelaLida['ordenacao'] | null) ?? [],
          filtros: (json(x['filtros']) as Record<string, unknown> | null) ?? null,
          itensPorPagina: vazio(x['itens_por_pagina']) ? null : num(x['itens_por_pagina']),
          padrao: bool(x['padrao']),
        }));
  const visaoInicialPorTela: Record<string, string> = {};
  for (const codigo of new Set(visoes.map((v) => v.tela))) {
    const v = visaoInicial(visoes.filter((x) => x.tela === codigo));
    if (v) visaoInicialPorTela[codigo] = v.nome;
  }
  return {
    guardadas: !!linha,
    geral: { ...geral, textoAmpliado: textoAmpliado(geral.zoomPercentual) },
    telaInicial:
      linha && !vazio(linha['tela_codigo'])
        ? {
            codigo: String(linha['tela_codigo']),
            titulo: String(linha['tela_titulo']),
            rota: String(linha['tela_rota']),
          }
        : null,
    telasDoMenu,
    visoes,
    visaoInicialPorTela,
  };
}
