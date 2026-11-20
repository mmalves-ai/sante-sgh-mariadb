// O .env.sante é carregado pelo carregador único de @sgh/legado (aplicarArquivoAmbiente), que recusa o .env.
/** Configuração da API lida do ambiente. Nada aqui é registrado em log (pode haver segredo ao lado). */
export interface Configuracao {
  readonly ambiente: string;
  readonly produtoNome: string;
  readonly dominioBase: string | null;
  readonly portaApi: number;
  /** Pacote de marca da rede (DP-49, DP-9): id registrado em @sgh/ui. */
  readonly marca: string;
  /** Rede padrão de localhost (ARQ-2). */
  readonly rede: string | null;
}

export const CONFIGURACAO = Symbol('CONFIGURACAO');

/** Nome técnico neutro usado só se PRODUTO_NOME faltar (DP-49: o nome do produto é parâmetro). */
const PRODUTO_NOME_AUSENTE = 'SGH';
/**
 * Pacote de marca usado se MARCA faltar: a marca provisória da Rede Santé (DP-9 provisório, 2026-10-19),
 * a única registrada até a DP-49 fechar. Outra rede define MARCA no arquivo de ambiente.
 */
const MARCA_PROVISORIA = 'rede-sante';

export function lerConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const porta = Number(env['API_PORTA'] ?? 3300);
  if (!Number.isInteger(porta) || porta <= 0) throw new Error('API_PORTA inválida');
  const marca = env['MARCA']?.trim();
  if (marca && !/^[a-z0-9-]+$/.test(marca))
    throw new Error('MARCA inválida (use letras minúsculas, dígitos e hífen)');
  return {
    ambiente: env['AMBIENTE'] ?? 'dev',
    produtoNome: env['PRODUTO_NOME']?.trim() || PRODUTO_NOME_AUSENTE,
    dominioBase: env['DOMINIO_BASE']?.trim() || null,
    portaApi: porta,
    marca: env['MARCA']?.trim() || MARCA_PROVISORIA,
    rede: env['REDE_PADRAO']?.trim() || null,
  };
}
