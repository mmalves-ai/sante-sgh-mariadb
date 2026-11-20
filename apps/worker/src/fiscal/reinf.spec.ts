// Regra 18 (unidade): o arquivo da EFD-REINF sai gerado e não enviado, só com a competência pedida, agrupado por
// prestador, com a contagem e o total conferíveis pelas parcelas; a impressão digital é a do conteúdo guardado.
import { createHash } from 'node:crypto';
import type { RetencaoServico } from '@sgh/dominio-financeiro';
import { describe, expect, it } from 'vitest';
import { type FonteReinf, gerarReinfDaCompetencia } from './reinf.js';

// CNPJ e documentos sintéticos (nenhum prestador real).
const RET: readonly RetencaoServico[] = [
  {
    cnpjPrestador: '11.111.111/0001-11',
    documento: 1,
    dataEmissao: '2026-09-05',
    valorBruto: 1000,
    inss: 110,
    ir: 15,
    csll: 10,
    pis: 6.5,
    cofins: 30,
  },
  {
    cnpjPrestador: '11.111.111/0001-11',
    documento: 2,
    dataEmissao: '2026-09-20',
    valorBruto: 500,
    inss: 55,
    ir: 7.5,
    csll: 5,
    pis: 3.25,
    cofins: 15,
  },
  {
    cnpjPrestador: '22.222.222/0001-22',
    documento: 3,
    dataEmissao: '2026-09-10',
    valorBruto: 2000,
    inss: 0,
    ir: 30,
    csll: 20,
    pis: 13,
    cofins: 60,
  },
  // Outra competência: fica de fora.
  {
    cnpjPrestador: '22.222.222/0001-22',
    documento: 4,
    dataEmissao: '2026-10-01',
    valorBruto: 9999,
    inss: 999,
    ir: 99,
    csll: 9,
    pis: 9,
    cofins: 9,
  },
];

function fonte() {
  const guardados: { nome: string; conteudo: string }[] = [];
  const registros: Parameters<FonteReinf['registrar']>[1][] = [];
  const f: FonteReinf = {
    retencoes: async () => RET,
    cnpjContribuinte: async () => '99.999.999/0001-99',
    guardar: async (_h, nome, conteudo) => {
      guardados.push({ nome, conteudo });
      return `memoria/${nome}`;
    },
    registrar: async (_h, d) => {
      registros.push(d);
      return { id: registros.length };
    },
  };
  return { f, guardados, registros };
}

describe('EFD-REINF da competência (gerado, não enviado)', () => {
  it('R-2000: INSS por prestador; o prestador sem INSS não entra', async () => {
    const { f, guardados, registros } = fonte();
    const r = await gerarReinfDaCompetencia(f, 'pc', '2026-09', 'R-2000');
    // 110 + 55 = 165 (o prestador 22… não teve INSS retido; o documento 4 é de outubro).
    expect(r).toMatchObject({ registros: 1, valorTotal: 165, situacao: 'gerado-nao-enviado' });
    expect(guardados[0]!.conteudo).toContain('<cnpjPrestador>11111111000111</cnpjPrestador>');
    expect(guardados[0]!.conteudo).toContain('<vlrTotalRetPrinc>165.00</vlrTotalRetPrinc>');
    // 1.000 + 500 = 1.500 de bruto; o documento de outubro (R$ 9.999,00) e o prestador sem INSS ficam de fora.
    expect(guardados[0]!.conteudo).toContain('<vlrTotalBruto>1500.00</vlrTotalBruto>');
    expect(guardados[0]!.conteudo).not.toContain('22222222000122');
    expect(r.hash).toBe(createHash('sha256').update(guardados[0]!.conteudo, 'utf8').digest('hex'));
    expect(registros[0]).toMatchObject({
      tipo: 'reinf-r2000',
      periodo: '2026-09',
      registros: 1,
      valorTotal: 165,
      chaveObjeto: 'memoria/reinf-r2000-2026-09.xml',
    });
  });

  it('R-4000: IR e CSRF por prestador, com as parcelas', async () => {
    const { f, registros } = fonte();
    const r = await gerarReinfDaCompetencia(f, 'pc', '2026-09', 'R-4000');
    // Prestador 11…: IR 15 + 7,5 = 22,5; CSRF (10 + 6,5 + 30) + (5 + 3,25 + 15) = 69,75 → 92,25.
    // Prestador 22…: IR 30; CSRF 20 + 13 + 60 = 93 → 123. Total 92,25 + 123 = 215,25.
    expect(r).toMatchObject({ registros: 2, valorTotal: 215.25 });
    expect(registros[0]).toMatchObject({ tipo: 'reinf-r4000', leiaute: 'EFD-REINF R-4000' });
  });

  it('competência inválida é recusada antes de ler', async () => {
    const { f, registros } = fonte();
    await expect(gerarReinfDaCompetencia(f, 'pc', '2026-9', 'R-4000')).rejects.toThrow(
      'Competência inválida',
    );
    expect(registros).toEqual([]);
  });
});
