// infra/compose/dev.yml (ficha do M01, seção 8, regra 7): todo serviço só em loopback, fora das portas
// ocupadas, com prefixo sgh-, imagem por tag exata e digest e healthcheck.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ConfigCompose,
  PORTAS_DO_COMPOSE,
  conferirCompose,
  portasEmUsoPorOutros,
  portasPublicadas,
} from './compose.ts';

const IMG = 'exemplo/servico:1.2.3@sha256:' + 'a'.repeat(64);
const valido: ConfigCompose = {
  name: 'sgh',
  services: {
    cache: {
      image: IMG,
      container_name: 'sgh-cache',
      ports: [{ host_ip: '127.0.0.1', published: '63718', target: 6379 }],
      healthcheck: { test: ['CMD', 'true'] },
    },
  },
  volumes: { dados: { name: 'sgh-dados' } },
  networks: { rede: { name: 'sgh-rede' } },
};
const comServico = (s: object): ConfigCompose => ({
  ...valido,
  services: { cache: { ...valido.services?.['cache'], ...s } },
});

describe('conferência do Compose', () => {
  it('aceita a configuração válida', () => {
    expect(conferirCompose(valido)).toEqual([]);
  });

  it('recusa porta em 0.0.0.0 ou sem IP', () => {
    expect(conferirCompose(comServico({ ports: [{ host_ip: '0.0.0.0', published: '63718' }] }))).toEqual([
      expect.stringContaining('só 127.0.0.1'),
    ]);
    expect(conferirCompose(comServico({ ports: [{ published: '63718' }] }))[0]).toContain('0.0.0.0');
  });

  it('recusa as portas ocupadas (3050, 5060, ...) e as fora da lista', () => {
    for (const p of ['3050', '5060', '8088', '14178']) {
      expect(conferirCompose(comServico({ ports: [{ host_ip: '127.0.0.1', published: p }] }))).toContain(
        `cache: porta ${p} é ocupada por outro projeto`,
      );
    }
    expect(
      conferirCompose(comServico({ ports: [{ host_ip: '127.0.0.1', published: '8080' }] }))[0],
    ).toContain('fora da lista');
  });

  it('recusa imagem sem digest, latest, sem healthcheck, sem prefixo sgh- e Firebird', () => {
    expect(conferirCompose(comServico({ image: 'exemplo/servico:1.2.3' }))).toHaveLength(1);
    expect(
      conferirCompose(comServico({ image: 'exemplo/servico:latest@sha256:' + 'a'.repeat(64) })),
    ).toHaveLength(1);
    expect(conferirCompose(comServico({ healthcheck: undefined }))).toEqual(['cache: sem healthcheck']);
    expect(conferirCompose(comServico({ container_name: 'cache' }))).toHaveLength(1);
    expect(
      conferirCompose(comServico({ image: 'firebirdsql/firebird:3.0.14@sha256:' + 'b'.repeat(64) }))[0],
    ).toContain('banco-dev');
    expect(conferirCompose({ ...valido, volumes: { v: { name: 'dados' } } })).toHaveLength(1);
  });

  it('acusa porta já publicada por container de outro projeto', () => {
    const portas = portasPublicadas(valido);
    expect(portasEmUsoPorOutros(portas, [{ nome: 'outro', portas: '0.0.0.0:63718->6379/tcp' }])).toHaveLength(
      1,
    );
    expect(
      portasEmUsoPorOutros(portas, [{ nome: 'sgh-valkey', portas: '127.0.0.1:63718->6379/tcp' }]),
    ).toEqual([]);
  });
});

describe('infra/compose/dev.yml (texto)', () => {
  const yml = readFileSync(resolve(import.meta.dirname, '../../../infra/compose/dev.yml'), 'utf8');

  it('projeto sgh; toda porta publicada começa por 127.0.0.1 e está na lista', () => {
    expect(yml).toMatch(/^name: sgh$/m);
    const portas = [...yml.matchAll(/^\s+- '([^']+)'$/gm)]
      .map((m) => m[1] ?? '')
      .filter((p) => /:\d+:/.test(p));
    expect(portas.length).toBe(PORTAS_DO_COMPOSE.length);
    for (const p of portas) expect(p).toMatch(/^127\.0\.0\.1:\d+:\d+$/);
    expect(portas.map((p) => Number(p.split(':')[1])).sort()).toEqual([...PORTAS_DO_COMPOSE].sort());
  });

  it('toda imagem com tag exata e digest; healthcheck e container sgh- em todo serviço; sem Firebird', () => {
    const imagens = [...yml.matchAll(/^\s+image: (\S+)$/gm)].map((m) => m[1] ?? '');
    expect(imagens.length).toBe(6); // M09: + otel (coletor OpenTelemetry);
    for (const i of imagens) expect(i).toMatch(/:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/);
    expect([...yml.matchAll(/^\s+healthcheck:$/gm)]).toHaveLength(6);
    expect([...yml.matchAll(/^\s+container_name: sgh-[a-z0-9-]+$/gm)]).toHaveLength(6);
    expect(yml).not.toMatch(/image: .*firebird/i);
    expect(yml).not.toMatch(/0\.0\.0\.0/);
  });
});
