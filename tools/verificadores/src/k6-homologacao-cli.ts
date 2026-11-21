// M39 (revisão): `pnpm k6 -- pico-recepcao-gravacao` na homologação (AMBIENTE=homolog; DP-15). Roda o k6 em Docker
// (tag e digest) contra a API da homologação (K6_BASE) com as contas de carga (K6_LOGINS e a senha do cofre em
// K6_SENHA, que só passam pelo ambiente do processo, nunca pela linha de comando) e grava o resumo agregado (só
// contagens e tempos) em docs/marcos/M39/carga-pico-recepcao-gravacao.json. A decisão de rodar é a de
// k6-homologacao.ts (recusa dev, ci e o banco de dev).
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ambienteEfetivo, caminhoArquivoAmbiente, lerConfiguracaoNucleo } from '@sgh/nucleo';
import {
  argumentosAmbienteDocker,
  decidirPicoGravacao,
  type EstabelecimentoK6,
  resumoJornada,
} from './k6-homologacao.ts';

/**
 * O destino do banco configurado, para a decisão recusar o banco de dev (loopback e portas da VM). O código é o do
 * estabelecimento da carga (K6_ESTABELECIMENTO). Configuração inválida: nenhum destino, e a decisão recusa.
 * Melhoria: o destino é o MariaDB do núcleo próprio, não a lista de bancos por estabelecimento antiga.
 */
function destinosDoBanco(env: Readonly<Record<string, string | undefined>>): EstabelecimentoK6[] {
  try {
    const c = lerConfiguracaoNucleo(env);
    return [{ codigo: env['K6_ESTABELECIMENTO']?.trim() ?? '', host: c.host, porta: c.porta }];
  } catch {
    return [];
  }
}

export async function rodarPicoGravacao(raiz: string, IMAGEM_K6: string): Promise<number> {
  const { env } = ambienteEfetivo(process.env, caminhoArquivoAmbiente(process.env, raiz));
  const d = decidirPicoGravacao(env, process.env, destinosDoBanco(env));
  if (!d.ok) {
    console.error(d.motivo);
    return 2;
  }
  mkdirSync(resolve(raiz, '.tmp'), { recursive: true });
  const saida = mkdtempSync(join(resolve(raiz, '.tmp'), 'k6-'));
  chmodSync(saida, 0o777);
  const filho = { ...process.env, BASE: d.base, ESTABELECIMENTO: d.estabelecimento };
  try {
    console.log(`▶ k6 pico-recepcao-gravacao na homologação (${d.base}; imagem ${IMAGEM_K6.split('@')[0]})`);
    const k6 = await new Promise<number>((ok) => {
      const p = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          `sgh-k6-${process.pid}`,
          '--network',
          'host',
          '-v',
          `${resolve(raiz, 'infra/k6')}:/scripts:ro`,
          '-v',
          `${saida}:/saida`,
          ...argumentosAmbienteDocker(filho),
          IMAGEM_K6,
          'run',
          '--quiet',
          '--no-usage-report',
          '/scripts/pico-recepcao-gravacao.js',
        ],
        { cwd: raiz, env: filho, stdio: ['ignore', 'inherit', 'inherit'] },
      );
      p.on('exit', (c) => ok(c ?? 1));
    });
    const resumo = JSON.parse(readFileSync(join(saida, 'resumo.json'), 'utf8')) as {
      metrics: Record<string, { values: Record<string, number> } | undefined>;
    };
    const conta = (m: string) => Math.round(resumo.metrics[m]?.values['count'] ?? 0);
    const resultado = {
      cenario: 'pico-recepcao-gravacao',
      data: new Date().toISOString(),
      ambiente: 'homolog (DP-15)',
      estabelecimento: d.estabelecimento,
      k6: {
        saida: k6,
        iteracoes: conta('iterations'),
        requisicoes: conta('http_reqs'),
        falhasPct: Number(((resumo.metrics['http_req_failed']?.values['rate'] ?? 0) * 100).toFixed(2)),
        gravacoes: {
          chamadas: conta('sgh_chamadas'),
          cadastros: conta('sgh_cadastros'),
          aberturas: conta('sgh_aberturas'),
        },
        jornadas: Object.fromEntries(
          ['senha-emitir', 'senha-chamar', 'paciente-cadastrar', 'atendimento-abrir'].map((j) => [
            j,
            resumoJornada(resumo.metrics, j),
          ]),
        ),
      },
    };
    const destino = resolve(raiz, 'docs/marcos/M39/carga-pico-recepcao-gravacao.json');
    writeFileSync(destino, JSON.stringify(resultado, null, 2) + '\n');
    console.log(JSON.stringify(resultado, null, 2));
    console.log(`Resumo gravado em ${destino}`);
    // O outro sistema sem piora é conferido na homologação pela vigilância e pelo MON$ do servidor (fora do runner).
    if (k6 !== 0) console.error(`✗ k6 saiu com ${k6} (limiar reprovado ou erro)`);
    return k6 === 0 ? 0 : 1;
  } finally {
    rmSync(saida, { recursive: true, force: true });
  }
}
