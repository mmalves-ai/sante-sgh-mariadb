// M59-F3 (ficha do M59, seção 5 e regra 7; cap-08 §8.11 "Onde está hoje"): os segredos de parceiros que ficam em texto
// puro em tabelas do banco do hospital e que só o sistema anterior lia. O Sante SGH já usa credencial própria, no
// cofre (M31, M49): para cada segredo, o gestor guarda no cofre a credencial que o Sante usa (de preferência a nova,
// combinada com o parceiro: rotação) e, com o período de contingência DESLIGADO, a coluna antiga recebe o valor "vazio"
// (integracao.cifrarSegredoLegado). O valor antigo nunca é lido pelo Sante: nem para copiar, nem para mostrar.
//
// Exceções (regra 7): TBINFBANCO é lido por 4 gatilhos que escrevem em banco externo e fica como está enquanto eles
// existirem (ou a TI desliga a integração, DP-16); as contas citadas em SP_MODULO_USUARIO (procedure que não pode ser
// alterada) só são rotacionadas depois de provar na cópia que o banco não depende delas.
//
// As senhas secundárias de TBUSUCPL (cancelamento de nota fiscal e a secundária) deixam de existir
// (acesso.retirarSenhaSecundaria): o Sante pede a reautenticação no lugar delas.
import { z } from 'zod';
import { esquemaLogin } from '../acesso/entrada.js';

export interface SegredoLegadoCatalogado {
  readonly tabela: string;
  /** Colunas da chave primária, na ordem do banco. */
  readonly chave: readonly string[];
  /** Colunas de segredo esvaziadas pela retirada. */
  readonly colunas: readonly string[];
  /**
   * Valor "vazio" que a coluna recebe: a forma vazia dominante que o perfil passivo mediu na coluna (NULL ou ''); a
   * referência da assinatura confere (tools/assinatura, conferirFormaVazia).
   */
  readonly vazio: Readonly<Record<string, null | ''>>;
  /** Coluna que descreve a linha para a tela (nome do convênio, do equipamento…), sem segredo nem dado pessoal. */
  readonly descricao: string | null;
  /** Texto de produto: o que é o segredo (a tela nunca mostra o nome da tabela). */
  readonly rotulo: string;
}

/** Os segredos de parceiro de TBCONVEN, TBTISSWEBSERV, TBCODATI, TBHOSPIT, GEUSERS, PREMAILCFG e SITPEQV. */
export const SEGREDOS_LEGADO: readonly SegredoLegadoCatalogado[] = [
  {
    tabela: 'TBCONVEN',
    chave: ['COD'],
    colunas: ['SENHA'],
    vazio: { SENHA: '' },
    descricao: 'NOME',
    rotulo: 'Senha de acesso ao portal do convênio',
  },
  {
    tabela: 'TBTISSWEBSERV',
    chave: ['ID_TBCONVEN', 'ID_TBTISSSCHEMA'],
    colunas: ['SENHA_PRESTADOR'],
    vazio: { SENHA_PRESTADOR: null },
    descricao: null,
    rotulo: 'Senha do prestador no serviço TISS da operadora',
  },
  {
    tabela: 'TBCODATI',
    chave: ['ID'],
    colunas: ['SENHA_PRESTADOR'],
    vazio: { SENHA_PRESTADOR: '' },
    descricao: null,
    rotulo: 'Senha do prestador por atividade do convênio',
  },
  {
    tabela: 'TBHOSPIT',
    chave: ['COD'],
    colunas: ['SENHAPROV', 'SENHA_PROXY', 'SENHA_ASSINATURA'],
    vazio: { SENHAPROV: '', SENHA_PROXY: '', SENHA_ASSINATURA: '' },
    descricao: null,
    rotulo: 'Senhas do estabelecimento (provedor, proxy e assinatura)',
  },
  {
    tabela: 'GEUSERS',
    chave: ['USUARIO'],
    colunas: ['SENHA'],
    vazio: { SENHA: null },
    descricao: null,
    rotulo: 'Senha antiga do almoxarifado por usuário',
  },
  {
    tabela: 'PREMAILCFG',
    chave: ['ID'],
    colunas: ['SENHA_AUTENTICACAO'],
    vazio: { SENHA_AUTENTICACAO: '' },
    descricao: null,
    rotulo: 'Senha do servidor de e-mail',
  },
  {
    tabela: 'SITPEQV',
    chave: ['CODIGO'],
    colunas: ['SENHA_FTP', 'SENHA_EXPORTACAO'],
    vazio: { SENHA_FTP: null, SENHA_EXPORTACAO: null },
    descricao: 'DESCRICAO',
    rotulo: 'Senhas de transferência dos equipamentos de laboratório',
  },
];

export const TABELAS_SEGREDO_LEGADO = SEGREDOS_LEGADO.map((s) => s.tabela);
export type TabelaSegredoLegado = (typeof SEGREDOS_LEGADO)[number]['tabela'];

/** Exceções registradas da regra 7 (o verificador de segredos e a tela as mostram com o motivo). */
export const EXCECOES_SEGREDO_LEGADO: readonly { readonly objeto: string; readonly motivo: string }[] = [
  {
    objeto: 'TBINFBANCO',
    motivo:
      'lida por 4 gatilhos que escrevem em banco externo: fica como está enquanto eles existirem ou até a TI desligar a integração (DP-16)',
  },
  {
    objeto: 'SP_MODULO_USUARIO',
    motivo:
      'procedure que não pode ser alterada: as contas citadas nela só são trocadas depois de provar na cópia que o banco não depende delas',
  },
];

/** Colunas de senha secundária de TBUSUCPL (chave EMPRESA + USUARIO). */
export const COLUNAS_SENHA_SECUNDARIA = ['SENHA_SEC', 'SENHA_CAN_NF'] as const;

export const segredoCatalogado = (tabela: string): SegredoLegadoCatalogado | null =>
  SEGREDOS_LEGADO.find((s) => s.tabela === tabela) ?? null;

// ── chave da linha ───────────────────────────────────────────────────────────────────────────────
// A linha vai na API e na tabela SGH_ como texto "COL=valor;COL=valor" (valores inteiros ou login; nada de ';' nem '=').

const VALOR_CHAVE = /^[A-Za-z0-9 ._@-]{1,31}$/;

export function chaveDaLinha(tabela: string, valores: Readonly<Record<string, unknown>>): string {
  const s = segredoCatalogado(tabela);
  if (!s) throw new Error(`Tabela sem segredo catalogado: ${tabela}`);
  return s.chave
    .map((c) => {
      const v = String(valores[c] ?? '').trimEnd();
      if (!VALOR_CHAVE.test(v)) throw new Error(`Chave inválida em ${tabela}.${c}`);
      return `${c}=${v}`;
    })
    .join(';');
}

/** Lê a chave da linha conferindo as colunas do catálogo; null se não bater. */
export function lerChaveDaLinha(tabela: string, texto: string): Record<string, string> | null {
  const s = segredoCatalogado(tabela);
  if (!s || texto.length > 120) return null;
  const partes = texto.split(';');
  if (partes.length !== s.chave.length) return null;
  const r: Record<string, string> = {};
  for (let i = 0; i < partes.length; i++) {
    const [c, v, ...resto] = (partes[i] ?? '').split('=');
    if (resto.length > 0 || c === undefined || c !== s.chave[i] || v === undefined || !VALOR_CHAVE.test(v))
      return null;
    r[c] = v;
  }
  return r;
}

// ── referência no cofre ──────────────────────────────────────────────────────────────────────────
// `cofre:parceiro/<estab>/<tabela>/<resumo da chave da linha>/<coluna>`: o resumo (16 hex do SHA-256 da chave) evita
// pôr a chave em claro no nome do arquivo do cofre; o cofre de arquivo ainda resume a referência inteira.

const REF =
  /^cofre:parceiro\/([a-z][a-z0-9]{0,9})\/([A-Z][A-Z0-9_]{1,30})\/([0-9a-f]{16})\/([A-Z][A-Z0-9_]{1,30})$/;

export function referenciaSegredoLegado(
  hospital: string,
  tabela: string,
  resumoChave: string,
  coluna: string,
): string {
  const r = `cofre:parceiro/${hospital}/${tabela}/${resumoChave}/${coluna}`;
  const s = segredoCatalogado(tabela);
  if (!REF.test(r) || !s || !s.colunas.includes(coluna))
    throw new Error('Estabelecimento, tabela ou coluna inválida para o cofre.');
  return r;
}

export function lerReferenciaSegredoLegado(
  r: string,
): { hospital: string; tabela: string; resumoChave: string; coluna: string } | null {
  const m = REF.exec(r);
  if (!m) return null;
  const s = segredoCatalogado(m[2]!);
  if (!s || !s.colunas.includes(m[4]!)) return null;
  return { hospital: m[1]!, tabela: m[2]!, resumoChave: m[3]!, coluna: m[4]! };
}

// ── entradas das operações e das rotas ──────────────────────────────────────────────────────────

const tabelaSegredo = z.enum(TABELAS_SEGREDO_LEGADO as [string, ...string[]]);
const textoChave = z.string().min(3).max(120);

/** Entrada de integracao.cifrarSegredoLegado: a linha da tabela (todas as colunas de segredo dela saem juntas). */
export const esquemaCifrarSegredoLegado = z
  .object({ tabela: tabelaSegredo, chave: textoChave })
  .strict()
  .superRefine((v, ctx) => {
    if (!lerChaveDaLinha(v.tabela, v.chave))
      ctx.addIssue({ code: 'custom', message: 'Chave da linha inválida.', path: ['chave'] });
  });
export type CifrarSegredoLegadoEntrada = z.infer<typeof esquemaCifrarSegredoLegado>;

/** Entrada de acesso.retirarSenhaSecundaria. */
export const esquemaRetirarSenhaSecundaria = z.object({ login: esquemaLogin }).strict();
export type RetirarSenhaSecundariaEntrada = z.infer<typeof esquemaRetirarSenhaSecundaria>;

/** POST .../segredos/guardar: a credencial que o Sante passa a usar, para o cofre (nunca volta em resposta). */
export const esquemaGuardarSegredoPedido = z
  .object({
    tabela: tabelaSegredo,
    chave: textoChave,
    coluna: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
    valor: z.string().min(1).max(200),
    /** O valor é o novo, combinado com o parceiro (rotação), e não o mesmo de antes. */
    rotacionado: z.boolean(),
    senha: z.string().min(1).max(64),
  })
  .strict();
export type GuardarSegredoPedido = z.infer<typeof esquemaGuardarSegredoPedido>;

export const esquemaRetirarSegredoPedido = z
  .object({ tabela: tabelaSegredo, chave: textoChave, senha: z.string().min(1).max(64) })
  .strict();

export const esquemaSenhaPedido = z.object({ senha: z.string().min(1).max(64) }).strict();

// ── respostas ───────────────────────────────────────────────────────────────────────────────────

const contagem = z.union([z.number().int().nonnegative(), z.literal('<5')]);
const dataHora = z.iso.datetime().nullable();

/** Por que a retirada não está disponível (texto da tela por código). */
export const BLOQUEIOS_RETIRADA = [
  'contingencia-ativa',
  'operacao-desligada',
  'cofre-indisponivel',
  'falta-no-cofre',
  'rotacao-pendente',
  'sem-valor',
] as const;
export type BloqueioRetirada = (typeof BLOQUEIOS_RETIRADA)[number];

export const esquemaLinhaSegredoLegado = z
  .object({
    tabela: tabelaSegredo,
    chave: textoChave,
    descricao: z.string().max(80).nullable(),
    /** Colunas com valor guardado hoje na tabela (nunca o valor). */
    comValor: z.array(z.string()),
    /** Colunas com credencial do Sante no cofre. */
    noCofre: z.array(z.string()),
    rotacionadoEm: dataHora,
    retiradoEm: dataHora,
    bloqueio: z.enum(BLOQUEIOS_RETIRADA).nullable(),
  })
  .strict();
export type LinhaSegredoLegado = z.infer<typeof esquemaLinhaSegredoLegado>;

export const TETO_LINHAS_SEGREDO = 300;

/** Resposta de GET /api/administracao/integracao/segredos-legado. */
export const esquemaSegredosLegadoResposta = z
  .object({
    hospital: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    em: z.iso.datetime(),
    contingenciaLigada: z.boolean(),
    cofreDisponivel: z.boolean(),
    receita: z.object({ ligada: z.boolean(), motivo: z.string().nullable() }).strict(),
    tabelas: z.array(
      z
        .object({
          tabela: tabelaSegredo,
          rotulo: z.string(),
          comValor: contagem,
          noCofre: contagem,
          rotacionados: contagem,
          retirados: contagem,
        })
        .strict(),
    ),
    linhas: z.array(esquemaLinhaSegredoLegado).max(TETO_LINHAS_SEGREDO),
    linhasTotal: z.number().int().nonnegative(),
    excecoes: z.array(z.object({ objeto: z.string(), motivo: z.string() }).strict()),
  })
  .strict();
export type SegredosLegadoResposta = z.infer<typeof esquemaSegredosLegadoResposta>;

export const esquemaFiltroSenhasSecundarias = z
  .object({
    busca: z.string().trim().max(31).optional(),
    pagina: z.coerce.number().int().min(1).max(500).default(1),
  })
  .strict();

export const TAMANHO_PAGINA_SENHA_SECUNDARIA = 50;

/** Resposta de GET /api/administracao/acesso/senhas-secundarias. */
export const esquemaSenhasSecundariasResposta = z
  .object({
    hospital: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    contingenciaLigada: z.boolean(),
    receita: z.object({ ligada: z.boolean(), motivo: z.string().nullable() }).strict(),
    porColuna: z.array(z.object({ coluna: z.enum(COLUNAS_SENHA_SECUNDARIA), usuarios: contagem }).strict()),
    usuariosComSenha: contagem,
    pagina: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    usuarios: z
      .array(
        z
          .object({
            login: z.string(),
            colunas: z.array(z.enum(COLUNAS_SENHA_SECUNDARIA)),
            /** Quem está na tela não retira a própria (segregação de funções). */
            proprio: z.boolean(),
          })
          .strict(),
      )
      .max(TAMANHO_PAGINA_SENHA_SECUNDARIA),
  })
  .strict();
export type SenhasSecundariasResposta = z.infer<typeof esquemaSenhasSecundariasResposta>;
