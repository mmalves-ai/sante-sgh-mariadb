// M56 (etapa 4, F3) na cópia, pela porta do legado da rede credenciada (READ ONLY): o apoio da tela (os 10 domínios com
// os rótulos do vocabulário, os convênios do hospital e a data do banco), a lista e as contagens da rede do
// estabelecimento dentro do tempo-alvo, os movimentos do RPS, e a gravação recusada em dev sobre a cópia
// compartilhada (`sghSoLeitura`). A chave da fatia, desligada na transação desfeita (regra 1; M61). Nada é gravado; só contagens
// e tempos no log.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaRedeOperadoraLegado } from '../rede-porta-legado.js';
import { ServicoRedeOperadora } from '../rede-servico.js';
import { situacaoComChavesDesligadas } from './chaves-desligadas.spec-util.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '2' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

describe.skipIf(!PODE)('rede credenciada da operadora na cópia (etapa 4, F3)', () => {
  it('o apoio, a lista, as contagens e os movimentos pela porta do legado; a fatia desligada; a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: cod };
    const porta = portaRedeOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, cod, 'SINT.CREDENCIAMENTO', ['operadora.rede']);
    expect(s.fatias.find((f) => f.chave === 'operadora.rede')?.situacao).toBe('desligada');
    const apoio = await new ServicoRedeOperadora(porta).apoio(c, {
      ligada: false,
      motivo: 'desligada',
      podeEditar: true,
      estabelecimentos: [{ codigo: cod, nome: 'Estabelecimento' }],
    });
    expect(apoio.podeEditar).toBe(false);
    expect(apoio.dominios.tipo[2]).toEqual({ codigo: 3, rotulo: 'Hospital geral' });
    expect(apoio.dominios.classificacao[0]).toEqual({ codigo: 1, rotulo: 'Assistência hospitalar' });
    // A natureza é domínio editável: o rótulo do banco, em frase.
    expect(apoio.dominios.natureza[0]?.rotulo).toMatch(/^Rede contratada/);
    expect(apoio.convenios.length).toBeGreaterThan(0);
    expect(apoio.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t0 = performance.now();
    const lista = await porta.prestadores(c, { busca: 'hospital' });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    const totais = await porta.totais(c);
    const movs = await porta.movimentos(c, { situacao: 'pendente' });
    expect(lista.itens.length).toBeLessThanOrEqual(totais.credenciados + totais.descredenciados);
    await expect(porta.gravarSgh(c, {} as never, async () => 1)).rejects.toMatchObject({ status: 403 });
    console.log(
      `[int-m56-4] ${cod}: fatia da rede desligada; apoio com ${Object.values(apoio.dominios).reduce((n, d) => n + d.length, 0)} códigos e ${apoio.convenios.length} convênios; lista em ${Math.round(ms)} ms (${lista.itens.length}); ${totais.credenciados} credenciados, ${movs.itens.length} movimentos pendentes; gravação recusada em dev`,
    );
  });
});
