// Montagem do módulo documento a partir do ambiente (porta de arquivos, Gotenberg, Valkey e chave do QZ Tray). Nada aqui
// vai a log. Em dev, a chave do QZ Tray é de teste, gerada no processo (a da Rede vem no deploy).
import { randomUUID, type webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ArmazemMemoria,
  type ArmazemIdempotencia,
  type DestinoFila,
  gerarParDeChavesQz,
  importarChavePrivadaQz,
  type TrabalhoZpl,
} from '@sgh/dominio-documento';
import type { ArmazemArquivos } from '@sgh/nucleo';
import type { Configuracao } from '../../configuracao.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { registrarConversaoPdf } from '../../telemetria.js';
import { type DependenciasEmissao, EmissaoService, politicaRetencao } from './aplicacao/emissao.service.js';
import { RegistroEmissoesMemoria } from './infra/registro.js';
import { armazemArquivosDoAmbiente } from './infra/arquivos.js';
import { ArmazemValkey, FilaZplValkey } from './infra/valkey.js';

type CryptoKey = webcrypto.CryptoKey;

export const FONTE_DOCUMENTO = Symbol('FONTE_DOCUMENTO');

export interface FonteDocumento {
  readonly emissao: EmissaoService;
  readonly armazem: ArmazemIdempotencia;
  readonly destino: DestinoFila & { readonly enviados: () => number };
  readonly chaveQz: () => Promise<CryptoKey>;
  /** Certificado público do QZ Tray (PEM), para o setCertificatePromise da estação; null sem arquivo. */
  readonly certificadoQz: () => string | null;
  readonly novoId: () => string;
}

export function criarFonteDocumento(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv = process.env,
  opcoes: {
    readonly certificadoSbis?: (estabelecimento: string) => Promise<string | null>;
    /** Porta de arquivos (ADR 0004); padrão: memória na sessão sintética, senão indisponível. */
    readonly armazem?: ArmazemArquivos;
    /** Id do estabelecimento pelo código (obrigatório com o banco próprio; ver DependenciasEmissao). */
    readonly idEstabelecimento?: (codigo: string) => Promise<number>;
    /** 03-PEP L131: a regra de cabeçalho por estabelecimento e tipo de documento (ver DependenciasEmissao). */
    readonly cabecalhoImpressao?: DependenciasEmissao['cabecalhoImpressao'];
  } = {},
): FonteDocumento {
  const armazem =
    opcoes.armazem ??
    armazemArquivosDoAmbiente({ nucleo: null, cliente: null, sintetico: fontesSinteticas(env), env });
  const nomes = new Map<string, string>();
  for (const cod of (env['ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)) {
    nomes.set(cod, env[`FB_${cod.toUpperCase()}_NOME`]?.trim() || cod);
  }
  const emissao = new EmissaoService({
    armazem,
    cliente: cfg.clientePadrao ?? 'sintetico',
    gotenbergUrl: env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318',
    registro: new RegistroEmissoesMemoria(),
    retencao: politicaRetencao(cfg.ambiente, env),
    produto: cfg.produtoNome,
    baseUrlValidacao: env['DOCUMENTO_URL_VALIDACAO']?.trim() || `http://127.0.0.1:${cfg.portaApi}`,
    nomeEstabelecimento: (c) => nomes.get(c) ?? c,
    aoConverter: (ms) => registrarConversaoPdf(ms / 1000),
    ...(opcoes.certificadoSbis ? { certificadoSbis: opcoes.certificadoSbis } : {}),
    ...(opcoes.idEstabelecimento ? { idEstabelecimento: opcoes.idEstabelecimento } : {}),
    ...(opcoes.cabecalhoImpressao ? { cabecalhoImpressao: opcoes.cabecalhoImpressao } : {}),
  });
  const valkey = env['VALKEY_URL']?.trim();
  const fila = valkey ? new FilaZplValkey(valkey) : null;
  let enviados = 0;
  let chave: Promise<CryptoKey> | null = null;
  const caminhoChave = env['QZ_CHAVE_PRIVADA_ARQUIVO']?.trim();
  return {
    emissao,
    armazem: valkey ? new ArmazemValkey(valkey) : new ArmazemMemoria(),
    // Fila zpl: com Valkey, o trabalho entra na lista da estação (o QZ Tray da estação consome e imprime;
    // leitura física no deploy). Sem Valkey (dev mínimo), só contado.
    destino: {
      enviar: async (t: TrabalhoZpl & { id: string }) => {
        if (fila) await fila.enviar(t);
        enviados++;
      },
      enviados: () => enviados,
    },
    chaveQz: () =>
      (chave ??= caminhoChave
        ? importarChavePrivadaQz(readFileSync(caminhoChave, 'utf8'))
        : gerarParDeChavesQz().then((p) => p.privateKey)),
    certificadoQz: () => {
      const caminho = env['QZ_CERTIFICADO_ARQUIVO']?.trim();
      if (!caminho) return null;
      const pem = readFileSync(caminho, 'utf8');
      if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(pem.trim() + '\n'))
        throw new Error('QZ_CERTIFICADO_ARQUIVO não é um certificado PEM.');
      return pem;
    },
    novoId: () => randomUUID(),
  };
}
