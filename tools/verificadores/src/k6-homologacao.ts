// M39 (revisão): o k6 do pico da recepção COM GRAVAÇÃO (`pnpm k6 -- pico-recepcao-gravacao`) roda SÓ na homologação
// (DP-15): a rodada grava com COMMIT pelas rotas reais, então na cópia de desenvolvimento compartilhada (AMBIENTE=dev
// ou ci, ACESSO_FONTE_DEV=copia, as portas 3351/3352) ela é recusada. Na homologação o runner não sobe API nem worker
// nem simula o outro sistema (lá o outro sistema é o de verdade, sobre a cópia descartável): ele roda o k6 contra a
// API da homologação (K6_BASE) com as contas de carga e grava o resumo agregado. Esta é a parte pura da decisão.

/** Portas das duas cópias do banco de dev compartilhado (../banco-dev): nunca destino de gravação do k6. */
export const PORTAS_COPIAS_DEV = [3351, 3352] as const;

/** As variáveis que o roteiro do k6 lê (o valor nunca vai na linha de comando: o Docker herda do ambiente). */
export const VARIAVEIS_PICO_GRAVACAO = [
  'BASE',
  'K6_LOGINS',
  'K6_SENHA',
  'RECEPCAO',
  'LOCAL',
  'GERADOR',
  'GERADOR_RECEPCAO',
  'GUICHE_BASE',
  'ESTABELECIMENTO',
  'USUARIOS',
  'SUBIDA',
  'PATAMAR',
  'ATENDIMENTO',
  'CEP',
  'DEPURAR',
] as const;

const BASE_HOMOLOGACAO = /^https?:\/\/(127\.0\.0\.1|localhost|[a-z0-9.-]+\.homologacao\.[a-z0-9.-]+)(:\d+)?$/;

export interface EstabelecimentoK6 {
  readonly codigo: string;
  readonly host: string;
  readonly porta: number;
}

export type DecisaoPicoGravacao =
  | { readonly ok: true; readonly base: string; readonly estabelecimento: string }
  | { readonly ok: false; readonly motivo: string };

/**
 * Decide se o pico com gravação pode rodar aqui. `env` é o ambiente efetivo (arquivo de ambiente + processo);
 * `processo` é o do runner (K6_BASE e as contas de carga). Recusa tudo o que não for AMBIENTE=homolog, a fonte de dev
 * pela cópia compartilhada e qualquer estabelecimento numa porta das cópias de dev; exige a BASE da homologação e as
 * contas de carga (a senha só presente, nunca lida aqui além disso).
 */
export function decidirPicoGravacao(
  env: Readonly<Record<string, string | undefined>>,
  processo: Readonly<Record<string, string | undefined>>,
  estabelecimentos: readonly EstabelecimentoK6[],
): DecisaoPicoGravacao {
  const ambiente = env['AMBIENTE']?.trim() || 'dev';
  if (ambiente !== 'homolog')
    return {
      ok: false,
      motivo: `pico-recepcao-gravacao grava com COMMIT: só em AMBIENTE=homolog (DP-15); o ambiente atual é ${ambiente}. No desenvolvimento, use o ensaio sobre a massa sintética (infra/k6/README.md).`,
    };
  if ((env['ACESSO_FONTE_DEV'] ?? processo['ACESSO_FONTE_DEV'])?.trim() === 'copia')
    return {
      ok: false,
      motivo:
        'ACESSO_FONTE_DEV=copia: a cópia de desenvolvimento compartilhada nunca recebe a carga com gravação.',
    };
  const naCopia = estabelecimentos.find((e) => (PORTAS_COPIAS_DEV as readonly number[]).includes(e.porta));
  if (naCopia)
    return {
      ok: false,
      motivo: `${naCopia.codigo}: porta ${naCopia.porta} é de uma cópia de desenvolvimento compartilhada; a carga com gravação é só na cópia descartável da homologação.`,
    };
  const base = processo['K6_BASE']?.trim() ?? '';
  if (!BASE_HOMOLOGACAO.test(base))
    return {
      ok: false,
      motivo:
        'K6_BASE: o endereço da API da homologação (http(s)://<host>.homologacao.<domínio> ou o loopback do servidor da homologação).',
    };
  const faltam = ['K6_LOGINS', 'K6_SENHA', 'RECEPCAO', 'LOCAL', 'GERADOR'].filter(
    (k) => !processo[k]?.trim(),
  );
  if (faltam.length > 0)
    return { ok: false, motivo: `Faltam ${faltam.join(', ')} (contas de carga e a recepção da rodada).` };
  const estabelecimento = processo['ESTABELECIMENTO']?.trim() || estabelecimentos[0]?.codigo || '';
  if (!estabelecimento) return { ok: false, motivo: 'Nenhum estabelecimento configurado.' };
  return { ok: true, base, estabelecimento };
}

/** Os argumentos `-e NOME` do Docker para as variáveis presentes (sem o valor: o processo filho herda do ambiente). */
export function argumentosAmbienteDocker(processo: Readonly<Record<string, string | undefined>>): string[] {
  return VARIAVEIS_PICO_GRAVACAO.filter((k) => processo[k]?.trim()).flatMap((k) => ['-e', k]);
}

/** Resumo agregado de uma jornada do k6 (só contagens e tempos). */
export function resumoJornada(
  metricas: Readonly<Record<string, { values: Record<string, number> } | undefined>>,
  jornada: string,
) {
  const d = metricas[`http_req_duration{jornada:${jornada}}`]?.values ?? {};
  const f = metricas[`http_req_failed{jornada:${jornada}}`]?.values ?? {};
  return {
    requisicoes: Math.round((f['passes'] ?? 0) + (f['fails'] ?? 0)),
    p50_ms: Math.round(d['p(50)'] ?? d['med'] ?? 0),
    p95_ms: Math.round(d['p(95)'] ?? 0),
    p99_ms: Math.round(d['p(99)'] ?? 0),
    max_ms: Math.round(d['max'] ?? 0),
    falhas: Number(((f['rate'] ?? 0) * 100).toFixed(2)),
  };
}
