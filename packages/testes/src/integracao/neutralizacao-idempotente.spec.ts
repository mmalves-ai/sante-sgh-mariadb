// Neutralização idempotente (ficha do M01, seção 10): rodar o neutralizar.sh da cópia compartilhada duas
// vezes dá o mesmo relatório, e a conferência do projeto (lerEstadoNeutralizacao, mais estrita que o
// relatório do script) dá 0 destino real antes e depois. Só roda contra o container de cópia do projeto,
// em AMBIENTE=dev. O script só reescreve dados de configuração com os mesmos valores; saída só com contagens.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type DestinoAprovado,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  conferirPublicacao,
  lerCodigos,
  lerEstadoNeutralizacao,
  listarContainers,
  validarPedidoCopia,
} from '@sgh/legado';
import { beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const script = resolve(raiz, env['SGH_BANCO_DEV'] ?? '../banco-dev', 'scripts', 'neutralizar.sh');

/** Linhas de contagem do bloco "--- depois" do relatório do script. */
function relatorioDepois(saida: string): string[] {
  const depois = saida.split('--- depois')[1] ?? '';
  return depois
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z].*\d+$/.test(l));
}

function neutralizar(codigo: string): string[] {
  const r = spawnSync('sh', [script, codigo], { encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0) throw new Error(`neutralizar.sh terminou com ${r.status ?? '?'}`);
  return relatorioDepois(r.stdout);
}

describe.each(codigos)('neutralização idempotente da cópia "%s"', (codigo) => {
  let alvo: DestinoAprovado;

  beforeAll(() => {
    alvo = validarPedidoCopia({ hospital: codigo, destino: 'dev' }, env);
    conferirPublicacao(alvo, listarContainers());
    expect(existsSync(script), `script da cópia compartilhada em ${script}`).toBe(true);
  });

  it('duas execuções dão o mesmo relatório e 0 destino real', () => {
    const primeira = neutralizar(codigo);
    const estado1 = lerEstadoNeutralizacao(alvo);
    const segunda = neutralizar(codigo);
    const estado2 = lerEstadoNeutralizacao(alvo);
    console.log(`[${codigo}] ${alvo.container}: ${JSON.stringify({ relatorio: segunda, estado: estado2 })}`);
    expect(primeira.length).toBeGreaterThan(0);
    expect(segunda).toEqual(primeira);
    expect(estado2).toEqual(estado1);
    expect(estado2.neutralizada).toBe(true);
  });
});
