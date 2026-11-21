// pnpm indicadores:controle -- --cliente=<código> --hospital=<cod|todos> (ficha do M16, seções 10 e 11): no banco
// próprio de dev (READ ONLY, loopback, AMBIENTE=dev), conta os valores de controle da internação e compara com os da
// ficha (cópia de 05-06/07/2026) quando a carga é dessa cópia; carga mais nova: só o resultado é registrado. Grava o
// resumo agregado em docs/marcos/M16/controle-<cod>.json (só contagens; nenhum dado de pessoa). Sai 1 com diferença.
// Melhoria: as chaves sem leitura no modelo próprio saem em `naoMedidos` (nunca comparadas como zero).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  abrirBancoDev,
  ambienteDoRepositorio,
  clienteDaLeitura,
  codigosDosEstabelecimentos,
} from './copia-leitura.ts';
import { CONTROLE_REFERENCIA, valoresDeControle } from './indicadores-controle-leitura.ts';

export { CONTROLE_REFERENCIA };

const raiz = resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const env = ambienteDoRepositorio();
const cliente = clienteDaLeitura(argv, { ...process.env, ...env });
if (!cliente) {
  console.error('Uso: pnpm indicadores:controle -- --cliente=<código> [--hospital=<cod|todos>]');
  process.exit(2);
}
const arg = argv.find((a) => a.startsWith('--hospital='))?.slice(11) ?? 'todos';
const { nucleo } = abrirBancoDev(cliente, env);
let ok = true;
try {
  const codigos = arg === 'todos' ? await codigosDosEstabelecimentos(nucleo, cliente) : [arg];
  for (const cod of codigos) {
    try {
      const r = await valoresDeControle(nucleo, cliente, cod);
      const referencia = r.dadosAte !== null && r.dadosAte >= '2026-07-05' && r.dadosAte <= '2026-07-06';
      const diferencas = referencia
        ? Object.entries(r.valores)
            .filter(
              ([k, obtido]) => CONTROLE_REFERENCIA[k] !== undefined && CONTROLE_REFERENCIA[k] !== obtido,
            )
            .map(([k, obtido]) => `${k}: esperado ${CONTROLE_REFERENCIA[k]}, obtido ${obtido}`)
        : [];
      if (diferencas.length > 0) ok = false;
      mkdirSync(resolve(raiz, 'docs/marcos/M16'), { recursive: true });
      writeFileSync(
        resolve(raiz, `docs/marcos/M16/controle-${cod}.json`),
        `${JSON.stringify({ estabelecimento: cod, dadosAte: r.dadosAte, copiaDeReferencia: referencia, valores: r.valores, naoMedidos: r.naoMedidos, diferencas }, null, 2)}\n`,
      );
      console.log(
        `[${cod}] dados até ${r.dadosAte ?? '(sem internação)'}${referencia ? ' (cópia de referência)' : ' (carga mais nova: só registro)'}: ` +
          `${diferencas.length === 0 ? 'valores medidos iguais' : `${diferencas.length} diferença(s)`}; ${r.naoMedidos.length} chave(s) sem leitura no modelo`,
      );
      for (const d of diferencas) console.log(`  ${d}`);
    } catch (e) {
      ok = false;
      console.log(
        `[${cod}] falhou: ${e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'erro'}`,
      );
    }
  }
} finally {
  await nucleo.encerrar();
}
process.exit(ok ? 0 : 1);
