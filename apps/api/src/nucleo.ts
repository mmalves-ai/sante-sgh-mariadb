// Núcleo da API (F2-L): o NucleoProprio de @sgh/nucleo (pool por banco de cliente, Leitor/Escritor, Executor). Falha de
// configuração não derruba a criação: devolve null e o log diz o porquê (sem segredo); o main.ts decide (fora de
// dev/ci, sem núcleo a API não sobe; em dev/ci, a fonte sintética).
import { type Ambiente, NucleoProprio } from '@sgh/nucleo';
import { logger } from './logger.js';

export function criarNucleo(env: Ambiente = process.env): NucleoProprio | null {
  try {
    return new NucleoProprio({ env });
  } catch (e) {
    logger.error({ erro: e instanceof Error ? e.name : 'erro' }, 'núcleo não configurado');
    return null;
  }
}

/**
 * Partida em segundo plano: confere a plataforma, a neutralização e o pool do cliente padrão, sem segurar a subida.
 * Só nomes de banco e contagens no log.
 */
export function partidaEmSegundoPlano(nucleo: NucleoProprio | null, cliente: string | null): void {
  if (!nucleo) return;
  const conferir = async () => {
    if (cliente) await nucleo.cliente(cliente);
    return nucleo.saude();
  };
  void conferir().then(
    (s) =>
      logger.info(
        {
          ambiente: s.ambiente,
          plataforma: s.plataforma,
          neutralizacao: s.neutralizacao,
          pools: s.pools.map((p) => ({ banco: p.banco, total: p.total })),
        },
        s.plataforma ? 'núcleo disponível' : 'núcleo: plataforma indisponível',
      ),
    (e: unknown) => logger.error({ erro: e instanceof Error ? e.name : 'erro' }, 'partida do núcleo falhou'),
  );
}
