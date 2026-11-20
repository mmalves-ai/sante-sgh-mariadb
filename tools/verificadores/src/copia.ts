// pnpm copia:restaurar / copia:neutralizar (M01): invólucros dos scripts da cópia compartilhada de dev
// (../banco-dev, fora do repositório; desvio do M01 de 2026-10-19), com as recusas da ficha.
//   pnpm copia:restaurar -- --hospital=<cod> [--destino=dev] [--conferir | --confirmar]
//   pnpm copia:neutralizar -- --hospital=<cod>
// Saída só com contagens. Nunca toca no sante-firebird.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type DestinoAprovado,
  ErroConfiguracaoEstabelecimentos,
  ErroCopia,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  conferirPublicacao,
  divergenciasDoCatalogo,
  formatarNeutralizacao,
  lerCatalogo,
  lerEstadoNeutralizacao,
  listarContainers,
  matrizRegistrada,
  validarPedidoCopia,
} from '@sgh/legado';
import { lerArgumentos } from './argumentos.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const args = lerArgumentos(process.argv.slice(2));
const acao = args.posicionais[0];

function pastaBancoDev(env: Record<string, string | undefined>): string {
  return resolve(raiz, env['SGH_BANCO_DEV'] ?? '../banco-dev');
}

function rodarScript(script: string, codigo: string): void {
  const r = spawnSync('sh', [script, codigo], { stdio: 'inherit' });
  if (r.status !== 0) throw new ErroCopia(`${script} terminou com erro (saída ${r.status ?? '?'}).`);
}

function imprimirCatalogo(alvo: DestinoAprovado): void {
  const c = lerCatalogo(alvo);
  console.log(
    `Catálogo de ${alvo.container}: Firebird ${c.versao}; ${c.tabelas} tabelas, ${c.triggers} triggers ` +
      `(${c.triggers_ativos} ativos), ${c.procedures} procedures, ${c.generators} generators, ` +
      `${c.funcoes_externas} funções externas declaradas (objetos SGH_ fora da conta).`,
  );
  const d = divergenciasDoCatalogo(c);
  console.log(
    d.length === 0
      ? 'Igual ao BRIEF §3.'
      : `Diverge do BRIEF §3 (registrar e comparar no M02): ${d.join('; ')}`,
  );
}

function principal(): number {
  if (acao !== 'restaurar' && acao !== 'neutralizar') {
    console.error('Uso: copia.ts restaurar|neutralizar --hospital=<código> [--destino=dev]');
    return 2;
  }
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente());
  const alvo = validarPedidoCopia(
    {
      hospital: args.opcoes['hospital'],
      destino: args.opcoes['destino'],
      container: args.opcoes['container'],
    },
    env,
  );
  const cod = alvo.estabelecimento.codigo;
  const pasta = pastaBancoDev(env);
  const script = resolve(pasta, 'scripts', `${acao}.sh`);
  if (!existsSync(script)) throw new ErroCopia(`Script da cópia compartilhada ausente: ${script}`);
  const containers = listarContainers();
  const noAr = containers.some((c) => c.nome === alvo.container);

  if (acao === 'neutralizar') {
    conferirPublicacao(alvo, containers);
    console.log(`Neutralizando ${alvo.container} (${cod}) por ${script}`);
    rodarScript(script, cod);
    const estado = lerEstadoNeutralizacao(alvo);
    for (const l of formatarNeutralizacao(estado)) console.log(`  ${l}`);
    console.log(
      estado.neutralizada ? 'Resultado: 0 destino real restante.' : 'Resultado: HÁ destino real restante.',
    );
    return estado.neutralizada ? 0 : 1;
  }

  // restaurar
  const arq = matrizRegistrada(readFileSync(script, 'utf8'), cod);
  if (!arq)
    throw new ErroCopia(
      `Recusado: "${cod}" não tem arquivo-matriz registrado em ${script} (.fbk sem registro).`,
    );
  if (
    !existsSync(resolve(pasta, 'backups', arq)) ||
    !existsSync(resolve(pasta, 'backups', `${arq}.sha256`))
  ) {
    throw new ErroCopia(`Recusado: matriz ${arq} ou seu .sha256 ausente em ${resolve(pasta, 'backups')}.`);
  }
  if (noAr) conferirPublicacao(alvo, containers);
  if (args.bandeiras.has('conferir')) {
    if (!noAr) throw new ErroCopia(`${alvo.container} não está no ar; nada a conferir.`);
    console.log(`Conferência (sem restaurar) de ${alvo.container}; matriz registrada: ${arq}`);
    imprimirCatalogo(alvo);
    return 0;
  }
  if (!args.bandeiras.has('confirmar')) {
    console.error(
      `A restauração para e recria o banco de ${alvo.container}, compartilhado com a sante-api.\n` +
        'Repita com --confirmar para restaurar, ou use --conferir para só conferir o catálogo.',
    );
    return 2;
  }
  console.log(`Restaurando ${alvo.container} da matriz ${arq} por ${script}`);
  rodarScript(script, cod);
  imprimirCatalogo(alvo);
  const estado = lerEstadoNeutralizacao(alvo);
  console.log(
    estado.neutralizada ? 'Neutralizada: 0 destino real restante.' : 'ATENÇÃO: há destino real restante.',
  );
  return estado.neutralizada ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(principal());
  } catch (e) {
    if (e instanceof ErroCopia || e instanceof ErroConfiguracaoEstabelecimentos) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
