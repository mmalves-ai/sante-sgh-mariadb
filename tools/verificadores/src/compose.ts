// Conferência do infra/compose/dev.yml antes de subir (M01; convencoes.md §10; POL-4): portas só em
// 127.0.0.1 e fora das ocupadas, nomes com prefixo sgh-, imagem por tag exata e digest, healthcheck em
// todos e nenhum Firebird (a cópia fica em ../banco-dev). Entrada: `docker compose config --format json`.
import { ENDERECOS_OCUPADOS, PORTAS_OCUPADAS } from '@sgh/legado';

/** Portas que o Compose do projeto publica (convencoes.md §10, sem as do Firebird). */
/** M09: 3331 = OTLP/HTTP do coletor OpenTelemetry (sgh-otel). */
export const PORTAS_DO_COMPOSE: readonly number[] = [63718, 9318, 9319, 3318, 8325, 1325, 3330, 3331];

interface PortaCompose {
  readonly host_ip?: string;
  readonly published?: string | number;
  readonly target?: number;
}

interface ServicoCompose {
  readonly image?: string;
  readonly container_name?: string;
  readonly ports?: readonly PortaCompose[];
  readonly healthcheck?: { readonly test?: readonly string[] | string; readonly disable?: boolean };
}

export interface ConfigCompose {
  readonly name?: string;
  readonly services?: Readonly<Record<string, ServicoCompose>>;
  readonly volumes?: Readonly<Record<string, { readonly name?: string }>>;
  readonly networks?: Readonly<Record<string, { readonly name?: string }>>;
}

const IMAGEM_FIXADA = /^[a-z0-9./_-]+:(?!latest@)[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/;

export interface PortaPublicada {
  readonly servico: string;
  readonly ip: string;
  readonly porta: number;
}

export function portasPublicadas(config: ConfigCompose): PortaPublicada[] {
  return Object.entries(config.services ?? {}).flatMap(([servico, s]) =>
    (s.ports ?? []).map((p) => ({ servico, ip: p.host_ip ?? '', porta: Number(p.published) })),
  );
}

/** Lista de problemas (vazia = pode subir). */
export function conferirCompose(config: ConfigCompose): string[] {
  const problemas: string[] = [];
  if (config.name !== 'sgh')
    problemas.push(`nome do projeto Compose deve ser "sgh" (está "${config.name ?? ''}")`);
  for (const [nome, s] of Object.entries(config.services ?? {})) {
    if (!s.container_name?.startsWith('sgh-')) problemas.push(`${nome}: container_name sem prefixo sgh-`);
    if (!s.image || !IMAGEM_FIXADA.test(s.image)) problemas.push(`${nome}: imagem sem tag exata e digest`);
    if (s.image && /firebird/i.test(s.image)) {
      problemas.push(`${nome}: o Firebird não entra neste Compose (a cópia de dev fica em ../banco-dev)`);
    }
    const teste = s.healthcheck?.test;
    if (!teste || s.healthcheck?.disable || (Array.isArray(teste) && teste[0] === 'NONE')) {
      problemas.push(`${nome}: sem healthcheck`);
    }
  }
  for (const p of portasPublicadas(config)) {
    if (p.ip !== '127.0.0.1') {
      problemas.push(`${p.servico}: porta ${p.porta} publicada em "${p.ip || '0.0.0.0'}" (só 127.0.0.1)`);
    }
    if (!Number.isInteger(p.porta) || p.porta <= 0)
      problemas.push(`${p.servico}: porta publicada indefinida`);
    if (PORTAS_OCUPADAS.includes(p.porta) || ENDERECOS_OCUPADOS.includes(`${p.ip}:${p.porta}`)) {
      problemas.push(`${p.servico}: porta ${p.porta} é ocupada por outro projeto`);
    }
    if (!PORTAS_DO_COMPOSE.includes(p.porta)) {
      problemas.push(`${p.servico}: porta ${p.porta} fora da lista de convencoes.md §10`);
    }
  }
  for (const [chave, v] of Object.entries(config.volumes ?? {})) {
    if (!v.name?.startsWith('sgh-')) problemas.push(`volume ${chave}: nome sem prefixo sgh-`);
  }
  for (const [chave, r] of Object.entries(config.networks ?? {})) {
    if (!r.name?.startsWith('sgh-')) problemas.push(`rede ${chave}: nome sem prefixo sgh-`);
  }
  return problemas;
}

/**
 * Portas do Compose já publicadas por container de outro projeto (pela listagem `docker ps`:
 * nome e portas). Container sgh-* já no ar não conta (subir de novo é idempotente).
 */
export function portasEmUsoPorOutros(
  portas: readonly PortaPublicada[],
  containers: readonly { readonly nome: string; readonly portas: string }[],
): string[] {
  const achados: string[] = [];
  for (const c of containers) {
    if (c.nome.startsWith('sgh-')) continue;
    for (const p of portas) {
      if (new RegExp(`:${p.porta}->`).test(c.portas))
        achados.push(`porta ${p.porta} já publicada por ${c.nome}`);
    }
  }
  return achados;
}
