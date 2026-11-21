// Containers no ar (nome e portas publicadas), pela listagem `docker ps`. Só leitura; nunca para nem altera.
import { spawnSync } from 'node:child_process';

export interface ContainerPublicado {
  readonly nome: string;
  readonly portas: string;
}

export class ErroDocker extends Error {}

/** Interpreta a saída de `docker ps --format '{{.Names}}\t{{.Ports}}'`. */
export function lerListagemContainers(saida: string): ContainerPublicado[] {
  return saida
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [nome = '', portas = ''] = l.split('\t');
      return { nome: nome.trim(), portas: portas.trim() };
    });
}

export function listarContainers(): ContainerPublicado[] {
  const r = spawnSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { encoding: 'utf8' });
  if (r.status !== 0) throw new ErroDocker('docker ps falhou: o Docker está no ar?');
  return lerListagemContainers(r.stdout ?? '');
}
