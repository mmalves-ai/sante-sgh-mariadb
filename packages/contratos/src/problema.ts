// Problem Details (RFC 9457) entre a API e a tela. A tela mostra mensagem em português claro, sem detalhe
// técnico, e o identificador de correlação para o suporte (regra 15 do M07).
import { z } from 'zod';

/** Tipos conhecidos (o `type` vem como URN `urn:sgh:problema:<tipo>`). */
export const TIPOS_PROBLEMA = [
  'conflito-de-versao',
  'nao-autenticado',
  'sem-permissao',
  'nao-encontrado',
  'entrada-invalida',
  'registro-em-edicao',
  'indisponivel',
  'erro-interno',
  // M05
  'reautenticacao-necessaria',
  'muitas-tentativas',
  'sessao-bloqueada',
  'operacao-bloqueada',
  'outro-estabelecimento',
  /** Conta sem senha guardada no legado: definir a senha no sistema atual (plano B, ADR 0012). */
  'primeiro-acesso',
  /** Endereço de acesso sem rede cadastrada (ARQ-2): a sessão de uma rede não vale noutra. */
  'rede-desconhecida',
  // M06
  /** A trilha de auditoria não pôde ser gravada: sem trilha, sem dado (a ação auditável não acontece). */
  'trilha-indisponivel',
  /** Sem vínculo assistencial com o paciente: nega, ou oferece a quebra de vidro (extras.quebraDeVidro). */
  'sem-vinculo',
  // M08
  /** Recusa de negócio da operação (duplicado, em uso, inativo, regra do legado): `codigo` diz qual. */
  'recusa-de-negocio',
  /** Recurso desligado com pré-requisito externo pendente (POL-3): a chave não liga. */
  'prerequisito-pendente',
  // M15
  /** Primeira abertura do prontuário do paciente na sessão sem o motivo de acesso (lista fechada; 422). */
  'motivo-necessario',
  /** Funcionalidade desligada neste estabelecimento ou setor (chave de liberação; recolher = desligar). */
  'recurso-desligado',
] as const;
export type TipoProblema = (typeof TIPOS_PROBLEMA)[number];

export const PREFIXO_TIPO_PROBLEMA = 'urn:sgh:problema:';

export const esquemaCampoAlterado = z.object({
  /** Nome do campo no vocabulário do novo (nunca a coluna legada). */
  campo: z.string().min(1),
  rotulo: z.string().min(1),
  /** Valor que a tela leu e o valor atual no banco, já formatados para exibição. */
  lido: z.string().nullable(),
  atual: z.string().nullable(),
});
export type CampoAlterado = z.infer<typeof esquemaCampoAlterado>;

export const esquemaProblema = z.looseObject({
  type: z.string().default('about:blank'),
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Identificador de correlação (também no cabeçalho x-correlacao). */
  correlacao: z.string().optional(),
  /** Só em conflito-de-versao: o que mudou desde a leitura. */
  alteracoes: z.array(esquemaCampoAlterado).optional(),
  /** Só em conflito-de-versao: em que sistema a linha foi alterada. */
  alteradoPor: z.enum(['legado', 'novo', 'desconhecido']).optional(),
  /** M06: sem vínculo assistencial, a quebra de vidro está disponível. */
  quebraDeVidro: z.boolean().optional(),
  /** Só no login: o usuário tem segundo fator cadastrado e o código é necessário. */
  segundoFatorNecessario: z.boolean().optional(),
  /** M08: código da recusa (duplicado, em-uso, nivel-nao-permitido…) e campos envolvidos. */
  codigo: z.string().optional(),
  campos: z.array(z.string()).optional(),
  /** Só na troca de senha: regras da política que a senha nova não cumpre. */
  falhas: z.array(z.string()).optional(),
  /** Só na troca de senha: as mesmas regras, com a mensagem em português de cada uma. */
  regras: z.array(z.object({ codigo: z.string(), mensagem: z.string() })).optional(),
  /** M25: o conflito de sincronização aberto e os bloqueios e avisos dos nove certos. */
  conflito: z.number().int().optional(),
  bloqueios: z.array(z.string()).optional(),
  avisos: z.array(z.string()).optional(),
  /** M53.4: na programação de férias recusada, todas as regras da CLT que a programação não cumpre (códigos). */
  recusas: z.array(z.string()).optional(),
  /**
   * W0-02 (D-CRUD-ORFAOS): na exclusão recusada, os registros dependentes (rótulo de produto, quantidade e amostra das
   * chaves; nunca o nome da tabela), o total e se a inativação é oferecida em vez disso.
   */
  dependentes: z
    .array(
      z.object({
        rotulo: z.string(),
        quantidade: z.number().int(),
        amostra: z.array(z.string()),
        origem: z.enum(['fk', 'logica']),
      }),
    )
    .optional(),
  total: z.number().int().optional(),
  podeInativar: z.boolean().optional(),
  /** M56.3: na baixa recusada por valor divergente, o devido calculado na data (o valor, a multa e os juros). */
  devido: z
    .object({
      data: z.string(),
      valor: z.number(),
      multa: z.number(),
      juros: z.number(),
      total: z.number(),
      dispensado: z.boolean(),
    })
    .optional(),
});
export type Problema = z.infer<typeof esquemaProblema>;

export function tipoDoProblema(p: Pick<Problema, 'type'>): TipoProblema | null {
  if (!p.type.startsWith(PREFIXO_TIPO_PROBLEMA)) return null;
  const t = p.type.slice(PREFIXO_TIPO_PROBLEMA.length);
  return (TIPOS_PROBLEMA as readonly string[]).includes(t) ? (t as TipoProblema) : null;
}

export function urnProblema(tipo: TipoProblema): string {
  return `${PREFIXO_TIPO_PROBLEMA}${tipo}`;
}
