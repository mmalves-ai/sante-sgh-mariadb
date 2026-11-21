// Configuração da API lida do ambiente. O ambiente é o do processo completado pelo arquivo .env da raiz do projeto,
// pelo carregador de @sgh/nucleo (o processo tem precedência; o arquivo só preenche o que falta). Fora de produção,
// a partida confere a neutralização do núcleo (nada sai para fora). Nada daqui vai a log: o arquivo tem segredos.
import {
  type Ambiente,
  caminhoArquivoAmbiente,
  FORMATO_CLIENTE,
  formatarNeutralizacao,
  lerArquivoAmbiente,
  verificarNeutralizacao,
} from '@sgh/nucleo';

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
  /** Cliente de dev (CLIENTE_PADRAO, código de plataforma.cliente): o pool do núcleo resolve o banco por ele. */
  readonly clientePadrao: string | null;
}

export const CONFIGURACAO = Symbol('CONFIGURACAO');

/** Porta padrão da API deste produto (atrás do proxy /api do web, em 127.0.0.1). */
export const PORTA_API_PADRAO = 3310;

/** Nome técnico neutro usado só se PRODUTO_NOME faltar (DP-49: o nome do produto é parâmetro). */
const PRODUTO_NOME_AUSENTE = 'SGH';
/**
 * Pacote de marca usado se MARCA faltar: a marca provisória (DP-9 provisório, 2026-10-19), a única registrada até
 * a DP-49 fechar. Outro cliente define MARCA no arquivo de ambiente.
 */
const MARCA_PROVISORIA = 'rede-sante';

export function lerConfiguracao(env: Ambiente = process.env): Configuracao {
  const porta = Number(env['API_PORTA'] ?? PORTA_API_PADRAO);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65_535) throw new Error('API_PORTA inválida');
  const marca = env['MARCA']?.trim();
  if (marca && !/^[a-z0-9-]+$/.test(marca))
    throw new Error('MARCA inválida (use letras minúsculas, dígitos e hífen)');
  const cliente = env['CLIENTE_PADRAO']?.trim() || null;
  if (cliente !== null && !FORMATO_CLIENTE.test(cliente))
    throw new Error('CLIENTE_PADRAO inválido (letra minúscula, depois letras, dígitos e _; até 40)');
  return {
    ambiente: env['AMBIENTE'] ?? 'dev',
    produtoNome: env['PRODUTO_NOME']?.trim() || PRODUTO_NOME_AUSENTE,
    dominioBase: env['DOMINIO_BASE']?.trim() || null,
    portaApi: porta,
    marca: marca || MARCA_PROVISORIA,
    rede: env['REDE_PADRAO']?.trim() || null,
    clientePadrao: cliente,
  };
}

/**
 * Aplica o arquivo de ambiente ao processo (só as chaves que faltam: o processo tem precedência). Devolve se o
 * arquivo foi lido. Nenhum valor é registrado.
 */
export function aplicarArquivoAmbiente(
  processo: Record<string, string | undefined> = process.env,
  caminho: string | null = caminhoArquivoAmbiente(processo),
): boolean {
  const arquivo = caminho ? lerArquivoAmbiente(caminho) : null;
  if (!arquivo) return false;
  for (const [k, v] of Object.entries(arquivo)) if (processo[k] === undefined) processo[k] = v;
  return true;
}

/**
 * Recusa de partida: fora de produção, a configuração tem de estar neutralizada (núcleo). Devolve o texto da
 * recusa (só nomes de chave, nunca valores) ou null quando pode subir.
 */
export function recusaDePartida(env: Ambiente = process.env): string | null {
  const r = verificarNeutralizacao(env);
  return r.ok ? null : formatarNeutralizacao(r);
}
