// Contratos das consultas de Administração › Organização e parâmetros (M10, ficha seção 7): alertas e gatilhos,
// servidor de e-mail e notificações, dados fiscais da empresa e os parâmetros gravados no banco com tipo e origem
// (tabela.coluna). Credencial nunca sai: o servidor de e-mail mostra só "definida / não definida" (regra 10).
import { z } from 'zod';

export const esquemaAlertas = z.object({
  alertas: z.array(
    z.object({
      id: z.number().int(),
      nome: z.string(),
      ativo: z.boolean(),
      origem: z.enum(['paciente', 'sistema']),
      exibicao: z.number().int().nullable(),
      idadeInicial: z.number().int().nullable(),
      idadeFinal: z.number().int().nullable(),
      cenario: z.string().nullable(),
      gatilhos: z.array(z.object({ opcao: z.string(), evento: z.string() })),
      usuarios: z.number().int(),
    }),
  ),
  destino: z.enum(['banco', 'memoria']),
});
export type Alertas = z.infer<typeof esquemaAlertas>;

export const esquemaServidorEmail = z.object({
  servidores: z.array(
    z.object({
      id: z.number().int(),
      servidor: z.string(),
      porta: z.number().int(),
      ssl: z.boolean(),
      usuarioDefinido: z.boolean(),
      senhaDefinida: z.boolean(),
    }),
  ),
  modulos: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  /** Fora de produção, todo e-mail vai à caixa de teste (regra 19): nenhum endereço real fica ligado. */
  saidaDeTeste: z.boolean(),
  destino: z.enum(['banco', 'memoria']),
});
export type ServidorEmail = z.infer<typeof esquemaServidorEmail>;

export const esquemaDadosFiscais = z.object({
  empresa: z
    .object({
      codigo: z.number().int(),
      nome: z.string(),
      cnpj: z.string().nullable(),
      inscricaoEstadual: z.string().nullable(),
      inscricaoMunicipal: z.string().nullable(),
      cnae: z.string().nullable(),
      municipio: z.string().nullable(),
      uf: z.string().nullable(),
      optanteSimples: z.boolean(),
      registroAns: z.number().int().nullable(),
      tipoEmpresa: z.string().nullable(),
      cooperativa: z.string().nullable(),
      construtora: z.string().nullable(),
      ativa: z.boolean(),
    })
    .nullable(),
  destino: z.enum(['banco', 'memoria']),
});
export type DadosFiscais = z.infer<typeof esquemaDadosFiscais>;

// ── Parâmetros do banco por módulo (40 tabelas) ──────────────────────────────────────────────────

export const SITUACOES_PARAMETRO_BANCO = ['valor', 'vazio', 'oculta', 'texto-longo', 'sem-linha'] as const;

export const esquemaParametroBanco = z.object({
  campo: z.string(),
  /** Origem: TABELA.COLUNA (texto técnico; a tela mostra como referência). */
  origem: z.string(),
  /** Tipo como o banco guarda (texto(n), inteiro, data, hora, decimal, letra). */
  tipo: z.string(),
  /** Descrição funcional (dicionário; comentário do banco como apoio); "a confirmar" quando falta. */
  descricao: z.string(),
  valor: z.string().nullable(),
  situacao: z.enum(SITUACOES_PARAMETRO_BANCO),
});
export type ParametroBanco = z.infer<typeof esquemaParametroBanco>;

export const esquemaTabelaParametros = z.object({
  chave: z.string(),
  rotulo: z.string(),
  modulo: z.string(),
  porUsuario: z.boolean(),
  linhas: z.number().int(),
  parametros: z.array(esquemaParametroBanco),
  /** Tabela de várias linhas: a vigente (vigências) ou todas pela chave (listas); null: linha única ou do login. */
  criterio: z.enum(['vigente', 'todas']).nullable(),
  /** Nas listas: todas as linhas pela chave, com os valores na ordem de `parametros`. */
  registros: z.array(z.object({ chave: z.string(), valores: z.array(z.string().nullable()) })),
});
export type TabelaParametrosBanco = z.infer<typeof esquemaTabelaParametros>;

export const esquemaIndiceParametrosBanco = z.object({
  tabelas: z.array(esquemaTabelaParametros.omit({ parametros: true, criterio: true, registros: true })),
  destino: z.enum(['banco', 'memoria']),
});
export type IndiceParametrosBanco = z.infer<typeof esquemaIndiceParametrosBanco>;
