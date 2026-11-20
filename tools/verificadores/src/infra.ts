// pnpm infra:subir / infra:descer (M01): serviços de infra/compose/dev.yml com --env-file .env.sante.
// Subir confere antes as portas (só 127.0.0.1, fora das ocupadas) e espera todos ficarem healthy.
// Descer preserva os volumes (nunca `down -v`).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listarContainers } from '@sgh/legado';
import { type ConfigCompose, conferirCompose, portasEmUsoPorOutros, portasPublicadas } from './compose.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const acao = process.argv[2];
const arquivoEnv = resolve(raiz, process.env['SGH_ARQUIVO_AMBIENTE'] ?? '.env.sante');
const base = ['compose', '-p', 'sgh', '-f', resolve(raiz, 'infra/compose/dev.yml'), '--env-file', arquivoEnv];

function docker(args: string[], capturar = false): { codigo: number; saida: string } {
  const r = spawnSync('docker', args, {
    cwd: raiz,
    encoding: 'utf8',
    stdio: capturar ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  return { codigo: r.status ?? 1, saida: r.stdout ?? '' };
}

function principal(): number {
  if (acao !== 'subir' && acao !== 'descer') {
    console.error('Uso: infra.ts subir|descer');
    return 2;
  }
  if (!existsSync(arquivoEnv)) {
    console.error(`Arquivo de ambiente ausente: ${arquivoEnv} (gere a partir do .env.example).`);
    return 1;
  }
  if (acao === 'descer') {
    const r = docker([...base, 'down']); // sem -v: os volumes sgh-* ficam
    if (r.codigo === 0) console.log('Serviços parados; volumes preservados.');
    return r.codigo;
  }
  // Conferência prévia: a configuração resolvida (não impressa, pode conter valores do .env.sante).
  const cfg = docker([...base, 'config', '--format', 'json'], true);
  if (cfg.codigo !== 0) return cfg.codigo;
  const config = JSON.parse(cfg.saida) as ConfigCompose;
  const portas = portasPublicadas(config);
  const problemas = [...conferirCompose(config), ...portasEmUsoPorOutros(portas, listarContainers())];
  if (problemas.length > 0) {
    console.error('Recusado: o Compose não passou na conferência prévia:');
    for (const p of problemas) console.error(`  - ${p}`);
    return 1;
  }
  console.log(
    `Conferência prévia ok: ${portas.length} portas, todas em 127.0.0.1 e fora das ocupadas ` +
      `(${portas.map((p) => p.porta).join(', ')}).`,
  );
  const up = docker([...base, 'up', '-d', '--wait', '--wait-timeout', '240']);
  if (up.codigo !== 0) return up.codigo;
  docker([...base, 'ps', '--format', '{{.Name}}\t{{.Status}}\t{{.Ports}}']);
  // Conferência depois de subir: o que está de fato publicado pelos containers sgh-*.
  const fora = listarContainers()
    .filter((c) => c.nome.startsWith('sgh-'))
    .flatMap((c) =>
      c.portas
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.includes('->') && !p.startsWith('127.0.0.1:')),
    );
  if (fora.length > 0) {
    console.error(`Porta publicada fora do loopback: ${fora.join(', ')}`);
    return 1;
  }
  console.log('Todos os serviços healthy, só em 127.0.0.1.');
  return 0;
}

process.exit(principal());
