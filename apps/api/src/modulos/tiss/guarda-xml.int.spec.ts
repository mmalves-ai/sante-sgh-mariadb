// Guarda por chave no disco local (ADR 0004; ficha do M31, regra 4): o XML TISS, os arquivos do financeiro, o arquivo
// exportado ao SUS e o laudo do patrimônio vão à pasta do banco do cliente sob a raiz de arquivos (aqui, a pasta
// temporária do cliente de teste). A chave ocupada é recusada antes de gravar e nunca é reescrita; o arquivo fica
// somente leitura; o caminho que sai da raiz é recusado; a leitura do laudo confere o hash. Conteúdo sintético.
import { stat } from 'node:fs/promises';
import { caminhoDoArquivo, criarPastaArquivosTeste, type PastaArquivosTeste, sha256 } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armazemFinanceiroLocal } from '../financeiro/armazem.js';
import { armazemLaudoLocal, chaveLaudo } from '../patrimonio/armazem-laudo.js';
import { armazemSusLocal } from '../sus/armazem.js';
import { armazemXmlLocal, type LocalizadorArquivos, localizadorDoNucleo } from './armazem-xml.js';

const texto = (s: string) => new TextEncoder().encode(s);
let pasta: PastaArquivosTeste;
let localizador: () => LocalizadorArquivos;

beforeAll(async () => {
  pasta = await criarPastaArquivosTeste();
  localizador = () => ({ caminho: async (cliente, chave) => caminhoDoArquivo(pasta.raiz, cliente, chave) });
});
afterAll(() => pasta.apagar());

describe('guarda local por chave (ADR 0004)', () => {
  it('XML TISS: grava uma vez, somente leitura, sobrescrita recusada, leitura íntegra', async () => {
    const arm = armazemXmlLocal(localizador, pasta.cliente);
    const chave = `pc/tiss/lotes/0/INT31-${Date.now()}.xml`;
    expect(await arm.guardar(chave, texto('<x>SINTETICO</x>'))).toEqual({ versao: null });
    await expect(arm.guardar(chave, texto('<x>OUTRO</x>'))).rejects.toThrow(/imutável/);
    await expect(arm.guardar(chave, texto('<x>SINTETICO</x>'))).rejects.toThrow(/imutável/);
    expect(new TextDecoder().decode((await arm.ler(chave))!)).toBe('<x>SINTETICO</x>');
    const s = await stat(caminhoDoArquivo(pasta.raiz, pasta.cliente, chave));
    expect(s.mode & 0o222).toBe(0);
    expect(await arm.ler('pc/tiss/lotes/0/inexistente.xml')).toBeNull();
  });

  it('caminho que sai da raiz é recusado (400 caminho-invalido)', async () => {
    const arm = armazemXmlLocal(localizador, pasta.cliente);
    await expect(arm.guardar('../fora.xml', texto('<x/>'))).rejects.toMatchObject({
      problema: { codigo: 'caminho-invalido' },
    });
    await expect(arm.ler('a/../../fora.xml')).rejects.toMatchObject({
      problema: { codigo: 'caminho-invalido' },
    });
  });

  it('financeiro: a chave ocupada é recusada', async () => {
    const arm = armazemFinanceiroLocal(localizador, pasta.cliente);
    const chave = `extrato/1/${sha256(texto('EXTRATO SINTETICO'))}.ofx`;
    await arm.guardar(chave, texto('EXTRATO SINTETICO'), 'text/plain');
    await expect(arm.guardar(chave, texto('EXTRATO SINTETICO'), 'text/plain')).rejects.toThrow(/imutável/);
    expect(new TextDecoder().decode((await arm.ler(chave))!)).toBe('EXTRATO SINTETICO');
  });

  it('SUS: recusada a transação, o arquivo recém-gravado sai; confirmado, fica', async () => {
    const arm = armazemSusLocal(localizador, pasta.cliente);
    const recusado = `sus/pc/ciha/202611/1-${Date.now()}.txt`;
    await arm.guardar(recusado, texto('LINHA SINTETICA'));
    await arm.remover(recusado, null);
    expect(await arm.ler(recusado)).toBeNull();
    const confirmado = `sus/pc/ciha/202611/2-${Date.now()}.txt`;
    await arm.guardar(confirmado, texto('LINHA SINTETICA 2'));
    await arm.fixar(confirmado, null);
    expect(new TextDecoder().decode((await arm.ler(confirmado))!)).toBe('LINHA SINTETICA 2');
    await expect(arm.guardar(confirmado, texto('OUTRA'))).rejects.toThrow(/imutável/);
    // Confirmado (fixado), o arquivo não se remove mais: 409 arquivo-retido e o arquivo continua no disco.
    await expect(arm.remover(confirmado, null)).rejects.toMatchObject({
      problema: { codigo: 'arquivo-retido' },
    });
    expect(await arm.ler(confirmado)).not.toBeNull();
  });

  it('SUS: a chave alheia (gravada por outra guarda ou por outro módulo) não é removida', async () => {
    const xml = armazemXmlLocal(localizador, pasta.cliente);
    const alheia = `pc/tiss/lotes/0/ALHEIO-${Date.now()}.xml`;
    await xml.guardar(alheia, texto('<x>SINTETICO</x>'));
    const sus = armazemSusLocal(localizador, pasta.cliente);
    await expect(sus.remover(alheia, null)).rejects.toMatchObject({ problema: { codigo: 'arquivo-retido' } });
    expect(await xml.ler(alheia)).not.toBeNull();
    // A chave gravada por outra instância da guarda do SUS também é alheia para esta.
    const outra = armazemSusLocal(localizador, pasta.cliente);
    const deOutra = `sus/pc/ciha/202611/3-${Date.now()}.txt`;
    await outra.guardar(deOutra, texto('LINHA SINTETICA 3'));
    await expect(sus.remover(deOutra, null)).rejects.toMatchObject({
      problema: { codigo: 'arquivo-retido' },
    });
    expect(await outra.ler(deOutra)).not.toBeNull();
    await outra.remover(deOutra, null);
    expect(await outra.ler(deOutra)).toBeNull();
  });

  it('patrimônio: o mesmo laudo é reaproveitado e a leitura confere o hash', async () => {
    const arm = armazemLaudoLocal(localizador, pasta.cliente);
    const pdf = texto('%PDF-1.7 LAUDO SINTETICO');
    const hash = sha256(pdf);
    expect(await arm.guardar('pc', pdf, hash)).toBe(chaveLaudo(hash));
    expect(await arm.guardar('outro', pdf, hash)).toBe(chaveLaudo(hash));
    expect(new TextDecoder().decode((await arm.ler('pc', chaveLaudo(hash)))!)).toBe(
      '%PDF-1.7 LAUDO SINTETICO',
    );
    expect(await arm.ler('pc', 'fora/do/padrao.pdf')).toBeNull();
    await expect(arm.guardar('pc', texto('OUTRO'), hash)).rejects.toMatchObject({
      problema: { codigo: 'arquivo-divergente' },
    });
  });

  it('sem núcleo, a guarda falha fechada (nunca cai noutro destino)', async () => {
    const arm = armazemXmlLocal(localizadorDoNucleo(null, {}), pasta.cliente);
    await expect(arm.guardar('pc/tiss/x.xml', texto('<x/>'))).rejects.toThrow(/núcleo ausente/);
  });
});
