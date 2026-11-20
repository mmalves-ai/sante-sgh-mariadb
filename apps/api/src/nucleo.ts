// Núcleo do legado na API (M02): pools por estabelecimento e verificação de schema na partida. Falha de
// configuração não derruba a API: as telas de coexistência respondem 503 e o log diz o porquê (sem segredo).
import { resolve } from 'node:path';
import { NucleoLegado, lerConfiguracaoNucleo } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export function criarNucleo(
  env: NodeJS.ProcessEnv = process.env,
  pasta: string = process.cwd(),
): NucleoLegado | null {
  try {
    return new NucleoLegado({
      env,
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(pasta, env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado'),
      aviso: (mensagem, campos) => logger.warn(campos, mensagem),
    });
  } catch (e) {
    logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'núcleo do legado não configurado');
    return null;
  }
}

/**
 * Partida em segundo plano: conferência do nome e schema-check de cada estabelecimento. Depois, nova
 * tentativa dos indisponíveis a cada FB_REVERIFICACAO_MS (padrão 60 s, de 5 s a 1 h; pendência do M02).
 */
export function partidaEmSegundoPlano(nucleo: NucleoLegado | null): void {
  if (!nucleo) return;
  void nucleo.partida().then(
    (saude) => {
      nucleo.reverificarPeriodicamente(nucleo.config.reverificacaoMs);
      for (const s of saude) {
        logger.info(
          {
            rede: nucleo.rede,
            estabelecimento: s.codigo,
            disponivel: s.disponivel,
            schema: s.schema?.estado ?? null,
            nomeConfere: s.nomeConfere,
          },
          s.disponivel ? 'estabelecimento disponível' : 'estabelecimento indisponível',
        );
      }
    },
    (e: unknown) => logger.error({ erro: e instanceof Error ? e.name : 'erro' }, 'partida do núcleo falhou'),
  );
}
