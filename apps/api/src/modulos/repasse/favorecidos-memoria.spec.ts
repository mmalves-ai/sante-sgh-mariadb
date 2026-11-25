import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaFavorecidosRepasseMemoria } from './favorecidos-memoria.js';

const c = { cliente: 'sintetico', hospital: 'SINT', usuario: 1, correlacao: 't' };
const codigo = async (p: Promise<unknown>) =>
  p.then(
    () => 'gravou',
    (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo']) : String(e)),
  );

describe('favorecidos do repasse em memória (fonte sintética do E2E)', () => {
  it('60/40 pela soma da fonte, enquadramento do fornecedor na retenção, encerrar sem apagar e conta do prestador', async () => {
    const p = new PortaFavorecidosRepasseMemoria();
    await p.incluirFavorecido(c, {
      profissional: 7002,
      tipo: 'proprio_profissional',
      percentual: 60,
      inicio: '2026-01-02',
    });
    const base = {
      profissional: 7002,
      tipo: 'pessoa_juridica',
      pessoaJuridica: 11,
      contaBancaria: 62,
      inicio: '2026-01-02',
    };
    expect(await codigo(p.incluirFavorecido(c, { ...base, percentual: 41 }))).toBe('regra-violada');
    expect(await codigo(p.incluirFavorecido(c, { ...base, contaBancaria: 61, percentual: 40 }))).toBe(
      'regra-violada',
    );
    const pj = await p.incluirFavorecido(c, { ...base, percentual: 40 });
    await p.incluirEnquadramento(c, 21, { regime: 'lucro_presumido', aliquotaIss: 2, inicio: '2026-01-02' });
    const lista = await p.listarFavorecidos(c, 7002);
    const empresa = lista.find((f) => f.id === pj.id)!;
    expect(empresa.retencoes.situacao).toBe('enquadrado');
    expect(empresa.retencoes.vigentes.map((v) => v.aliquotaIss)).toEqual([2]);
    expect(await codigo(p.encerrarFavorecido(c, pj.id, { versao: 1, fim: '2027-01-01' }))).toBe('gravou');
    expect(await codigo(p.encerrarFavorecido(c, pj.id, { versao: 2, fim: '2027-02-01' }))).toBe(
      'regra-violada',
    );
    expect((await p.listarFavorecidos(c, 7002)).length).toBe(2);
    const pr = await p.incluirPrestador(c, {
      codigo: 'E2E1',
      nome: 'CLINICA',
      tipoPessoa: 'juridica',
      cnpj: '37110492000188',
    });
    expect(
      await codigo(
        p.incluirPrestador(c, {
          codigo: 'E2E1',
          nome: 'CLINICA DOIS',
          tipoPessoa: 'juridica',
          cnpj: '37110492000188',
        }),
      ),
    ).toBe('duplicado');
    await p.incluirContaPrestador(c, pr.id, { tipoChavePix: 'cnpj', chavePix: '37110492000188' });
    expect(
      (await p.listarContas(c, { tipo: 'prestador_terceiro', id: pr.id })).map((x) => x.documentoFinal),
    ).toEqual(['0188']);
  });
});
