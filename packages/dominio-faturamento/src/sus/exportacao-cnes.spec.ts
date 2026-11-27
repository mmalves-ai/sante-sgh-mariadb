import { describe, expect, it } from 'vitest';
import {
  criticarProfissionalCnes,
  montarExportacaoProfissionaisCnes,
  type ProfissionalParaExportacaoCnes,
} from './exportacao-cnes.js';

// Massa sintética: CPF e cartão de saúde gerados para teste (dígitos verificadores válidos), sem pessoa real.
const ok: ProfissionalParaExportacaoCnes = {
  nome: 'Profissional Sintético A & B',
  cpf: '529.982.247-25',
  cns: '700000000000005',
  cbo: '225125',
  vinculo: { vinculo: '01', tipo: '01', subtipo: '00' },
  cargaAmbulatorial: 20,
  cargaHospitalar: 10,
  cargaOutros: 0,
  conselho: { sigla: 'CRM', uf: 'SP', numero: '123456' },
  atendeSus: true,
};

describe('exportação dos profissionais para o cadastro nacional', () => {
  it('gera o XML com os profissionais sem pendência e escapa o texto', () => {
    const r = montarExportacaoProfissionaisCnes({
      codigoCnes: '1234567',
      cnpj: '11.222.333/0001-81',
      competencia: '202611',
      profissionais: [ok, { ...ok, nome: 'Sem CBO', cbo: null }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exportados).toBe(1);
    expect(r.nomeArquivo).toBe('profissionais-cnes-1234567-202611.xml');
    expect(r.xml).toContain('cnes="1234567" cnpj="11222333000181" competencia="202611" quantidade="1"');
    expect(r.xml).toContain('<cpf>52998224725</cpf>');
    expect(r.xml).toContain('A &amp; B');
    expect(r.xml).toContain('cbo="225125" vinculo="01" tipo="01" subtipo="00"');
    expect(r.pendencias).toEqual([
      { sequencia: 2, nome: 'Sem CBO', motivos: ['Sem ocupação (CBO) de 6 dígitos.'] },
    ]);
  });

  it('recusa sem CNES de 7 dígitos, competência inválida ou nenhum exportável', () => {
    expect(
      montarExportacaoProfissionaisCnes({
        codigoCnes: '12',
        cnpj: null,
        competencia: '202611',
        profissionais: [ok],
      }).ok,
    ).toBe(false);
    expect(
      montarExportacaoProfissionaisCnes({
        codigoCnes: '1234567',
        cnpj: null,
        competencia: '202613',
        profissionais: [ok],
      }).ok,
    ).toBe(false);
    const r = montarExportacaoProfissionaisCnes({
      codigoCnes: '1234567',
      cnpj: null,
      competencia: '202611',
      profissionais: [{ ...ok, vinculo: null }],
    });
    expect(r.ok).toBe(false);
    expect(r.pendencias).toHaveLength(1);
  });

  it('critica CPF, cartão de saúde, vínculo e carga horária', () => {
    expect(
      criticarProfissionalCnes({
        ...ok,
        cpf: '111',
        cns: '123',
        vinculo: null,
        cargaAmbulatorial: 0,
        cargaHospitalar: 0,
      }),
    ).toEqual([
      'CPF ausente ou inválido.',
      'Cartão de saúde inválido.',
      'Sem vínculo de trabalho do cadastro nacional.',
      'Sem carga horária semanal.',
    ]);
    expect(criticarProfissionalCnes({ ...ok, cns: null })).toEqual([]);
  });
});
