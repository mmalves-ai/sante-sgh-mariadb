// Preferências do usuário no banco próprio (01-ADM L84), pelo Executor (trilha, saída e idempotência na mesma
// transação). A preferência é sempre a da própria conta da sessão (nunca de outra pessoa) e segue o usuário em
// qualquer computador:
// - preferencias.gravarGeral: tema, densidade, texto ampliado (zoom), tela inicial do menu, filtro inicial de
//   atendimento e alerta em janela, numa linha por usuário (criada na primeira gravação, depois alterada);
// - preferencias.gravarVisaoTela: a visão salva de uma tela (colunas na ordem, ordenação, filtros, itens por
//   página), por nome; marcar uma como padrão tira a marca das outras da mesma tela (nada é apagado).
// As regras ficam em `@sgh/dominio-acesso` (preferencias/preferencias-usuario.ts). A tela inicial e a lista de
// telas que podem sê-la seguem só os níveis de acesso do cargo: a rota precisa estar numa entrada do menu cuja
// permissão de leitura a sessão tem (`permissoesSessao`, preenchida pela rota da API a partir da sessão).
// As telas do menu vêm do código (a árvore do menu): a tela é registrada em `tela_sistema` na primeira vez em que
// alguém a escolhe como inicial ou guarda uma visão dela (código derivado do endereço), sem carga prévia. A visão só
// é aceita em tela que oferece lista (`colunasVisaoDaRota`) e só com as colunas que essa lista oferece.
import { ARVORE_MENU, colunasVisaoDaRota } from '@sgh/contratos';
import {
  codigoTelaDoMenu,
  conferirTelaInicial,
  conferirVisaoTela,
  MENSAGEM_PREFERENCIA,
  NOME_VISAO_PADRAO,
  normalizarPreferenciaGeral,
  PREFERENCIA_GERAL_PADRAO,
  rotaPermitida,
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
    /**
     * Permissões da sessão. A rota da API sempre as preenche a partir da sessão, por cima do que vier no corpo;
     * ausentes, nenhuma tela é permitida como inicial (falha fechada).
     */
    permissoesSessao: z.array(z.string().max(120)).max(5000).optional(),
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

const SQL_TELA = 'SELECT id, ativo, rota, avulsa FROM tela_sistema';

/** Código do módulo do sistema a partir da área do menu (sem acento, minúsculo, até 30 caracteres). */
const codigoModuloDaArea = (area: string): string =>
  `menu.${area
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`.slice(0, 30);

/** Inclui e, se outra sessão incluiu a mesma chave no mesmo instante, relê (a linha existe de um jeito ou de outro). */
async function incluirOuReler(
  tx: TxOperacao,
  tabela: string,
  valores: Record<string, unknown>,
  reler: () => Promise<Record<string, unknown> | null | undefined>,
): Promise<void> {
  try {
    await tx.incluir(tabela, valores as Parameters<TxOperacao['incluir']>[1]);
  } catch (e) {
    if (!(await reler())) throw e;
  }
}

/**
 * A tela pelo código. A tela do menu que ainda não está no banco é registrada aqui (ativa, com o endereço e o título
 * do menu, no módulo da área do menu): o cadastro das telas vem do código, não de carga. Código fora do menu e fora
 * do banco: nulo.
 */
async function telaPorCodigo(tx: TxOperacao, codigo: string) {
  const achada = await tx.uma(`${SQL_TELA} WHERE codigo = ?`, [codigo]);
  if (achada) return achada;
  const item = ARVORE_MENU.find((i) => i.rota && i.permissao && codigoTelaDoMenu(i.rota) === codigo);
  if (!item?.rota) return null;
  const rota = item.rota;
  // Já registrada com outro código (carga anterior do cadastro): vale a que está no banco.
  const porRota = await tx.uma(`${SQL_TELA} WHERE rota = ?`, [rota]);
  if (porRota) return porRota;
  const codigoModulo = codigoModuloDaArea(item.area);
  const lerModulo = () => tx.uma('SELECT id FROM modulo_sistema WHERE codigo = ?', [codigoModulo]);
  if (!(await lerModulo()))
    await incluirOuReler(
      tx,
      'modulo_sistema',
      { codigo: codigoModulo, descricao: item.area.slice(0, 150), area: item.area.slice(0, 60) },
      lerModulo,
    );
  const modulo = await lerModulo();
  const lerTela = () => tx.uma(`${SQL_TELA} WHERE rota = ?`, [rota]);
  await incluirOuReler(
    tx,
    'tela_sistema',
    {
      codigo,
      descricao: item.titulo.slice(0, 150),
      titulo: item.titulo.slice(0, 150),
      modulo_sistema_id: num(modulo!['id']),
      rota,
    },
    lerTela,
  );
  return lerTela();
}

const operacaoGravarGeral = definirOperacao({
  nome: 'preferencias.gravar_geral',
  tabelas: ['preferencia_usuario', 'tela_sistema', 'modulo_sistema'],
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
        const rota = t ? ((t['rota'] as string | null) ?? null) : null;
        const recusaTela = conferirTelaInicial(
          t
            ? {
                ativa: bool(t['ativo']),
                rota,
                avulsa: bool(t['avulsa']),
                permitida: rotaPermitida(rota, ARVORE_MENU, new Set(e.permissoesSessao ?? [])),
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
  tabelas: ['preferencia_tela_usuario', 'tela_sistema', 'modulo_sistema'],
  entrada: esquemaGravarVisaoTela,
  async gravar(tx, e) {
    const usuario = usuarioDaSessao(tx);
    const t = await telaPorCodigo(tx, e.tela);
    if (!t || !bool(t['ativo'])) throw recusar('tela-inexistente');
    const tela = num(t['id']);
    // Só a tela que oferece lista guarda visão, e só com as colunas que a lista oferece.
    const colunasDaTela = colunasVisaoDaRota(vazio(t['rota']) ? null : String(t['rota']));
    if (!colunasDaTela) throw recusar('tela-sem-visao');
    const daTela = await tx.consultarParaAtualizar(
      'SELECT id, versao, nome, padrao FROM preferencia_tela_usuario WHERE usuario_id = ? AND tela_sistema_id = ?',
      [usuario, tela],
    );
    const nomePedido = (e.nome ?? NOME_VISAO_PADRAO).trim();
    const mesma = daTela.find((a) => String(a['nome']) === nomePedido);
    const r = conferirVisaoTela(e, {
      colunasDaTela,
      primeiraDaTela: daTela.length === 0,
      padraoAtual: mesma ? bool(mesma['padrao']) : undefined,
    });
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
  /** Telas do menu do cargo, vindas do código (podem ser a inicial); o código é o do banco quando já registrada. */
  readonly telasDoMenu: { codigo: string; titulo: string; rota: string }[];
  readonly visoes: VisaoTelaLida[];
  /** Por tela, o nome da visão que a tela abre. */
  readonly visaoInicialPorTela: Record<string, string>;
}

/**
 * Lê as preferências da conta (sem conta: as de fábrica, nada guardado). `tela` filtra as visões. `permissoes` são
 * as da sessão: as telas que podem ser a inicial são só as do menu do cargo, e a tela inicial guardada que o cargo
 * deixou de alcançar não é devolvida (a linha fica como está; volta a valer se o acesso voltar).
 */
export async function lerPreferenciasDoUsuario(
  l: LeitorPreferencias,
  usuario: number | null,
  tela?: string,
  permissoes: ReadonlySet<string> = new Set(),
): Promise<PreferenciasLidas> {
  const permitida = (rota: unknown) =>
    rotaPermitida(vazio(rota) ? null : String(rota), ARVORE_MENU, permissoes);
  // As telas vêm do menu (código); a que já está registrada no banco usa o código e o título de lá, e a que o
  // banco marcou como inativa ou avulsa não é oferecida.
  const noBanco = new Map(
    (
      await l.consultar(
        'SELECT codigo, titulo, rota, ativo, avulsa FROM tela_sistema WHERE rota IS NOT NULL',
        [],
        { teto: 5000 },
      )
    ).map((x) => [String(x['rota']), x] as const),
  );
  const porRota = new Map<string, { codigo: string; titulo: string; rota: string }>();
  for (const i of ARVORE_MENU) {
    if (!i.rota || !i.permissao || porRota.has(i.rota) || !permitida(i.rota)) continue;
    const b = noBanco.get(i.rota);
    if (b && (!bool(b['ativo']) || bool(b['avulsa']))) continue;
    porRota.set(i.rota, {
      codigo: b ? String(b['codigo']) : codigoTelaDoMenu(i.rota),
      titulo: b ? String(b['titulo']) : i.titulo,
      rota: i.rota,
    });
  }
  const telasDoMenu = [...porRota.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
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
      linha && !vazio(linha['tela_codigo']) && permitida(linha['tela_rota'])
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
