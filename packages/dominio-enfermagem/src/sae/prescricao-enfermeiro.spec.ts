// Regra 17 do M45 (etapa 4; Res. COFEN 801/2026): a prescrição de medicamento pelo enfermeiro — só na consulta de
// enfermagem, só pelo enfermeiro, só com protocolo publicado e com os medicamentos da lista do anexo II (parâmetro
// versionado) que o protocolo permite; a receita com o conteúdo mínimo do art. 3º e a impressão SHA-256. Dados
// SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  conferirReceitaEnfermeiro,
  cpfMascarado,
  impressaoDaReceita,
  lerAnexoII,
  lerProtocolosEnfermeiro,
  textoDaReceitaEnfermeiro,
} from './prescricao-enfermeiro.js';

const PROTOCOLOS = lerProtocolosEnfermeiro(
  'PROT-DOR/2026:institucional:paracetamol, dipirona;HAS/2025:programa:losartana;formato errado;X/2026:programa:',
);
const LISTA = lerAnexoII('ANEXO-II-SINT-1=paracetamol,dipirona,losartana,sulfato ferroso');
const item = {
  medicamento: 'Paracetamol',
  via: 'oral',
  posologia: '500 mg de 6 em 6 horas se dor',
  quantidade: '20 comprimidos',
};

describe('regra 17: os parâmetros (protocolos e anexo II)', () => {
  it('lê os protocolos no formato e ignora o resto; a lista com a versão', () => {
    expect(PROTOCOLOS).toEqual([
      { codigo: 'PROT-DOR', ano: 2026, tipo: 'institucional', medicamentos: ['paracetamol', 'dipirona'] },
      { codigo: 'HAS', ano: 2025, tipo: 'programa', medicamentos: ['losartana'] },
    ]);
    expect(LISTA).toEqual({
      versao: 'ANEXO-II-SINT-1',
      medicamentos: ['paracetamol', 'dipirona', 'losartana', 'sulfato ferroso'],
    });
    expect(lerAnexoII('')).toBeNull();
    expect(lerAnexoII('V1=')).toBeNull();
    expect(lerProtocolosEnfermeiro(null)).toEqual([]);
  });
});

describe('regra 17: a conferência da receita', () => {
  const o = { consultaDeEnfermagem: true, enfermeiro: true, protocolos: PROTOCOLOS, lista: LISTA };
  it('confere: o genérico normalizado, na lista e no protocolo', () => {
    expect(conferirReceitaEnfermeiro({ protocolo: 'PROT-DOR/2026', itens: [item] }, o)).toMatchObject({
      ok: true,
      protocolo: { codigo: 'PROT-DOR', tipo: 'institucional' },
      itens: [{ medicamento: 'paracetamol' }],
    });
  });
  it('só o enfermeiro, só na consulta de enfermagem, só com a lista publicada e o protocolo publicado', () => {
    const e = { protocolo: 'PROT-DOR/2026', itens: [item] };
    expect(conferirReceitaEnfermeiro(e, { ...o, enfermeiro: false })).toMatchObject({
      codigo: 'so-enfermeiro',
    });
    expect(conferirReceitaEnfermeiro(e, { ...o, consultaDeEnfermagem: false })).toMatchObject({
      codigo: 'fora-da-consulta-de-enfermagem',
    });
    expect(conferirReceitaEnfermeiro(e, { ...o, lista: null })).toMatchObject({ codigo: 'sem-lista' });
    expect(conferirReceitaEnfermeiro({ ...e, protocolo: 'PROT-DOR/2025' }, o)).toMatchObject({
      codigo: 'protocolo-nao-publicado',
    });
    expect(
      conferirReceitaEnfermeiro(e, {
        ...o,
        protocolos: [
          { codigo: 'PROT-DOR', ano: 2026, tipo: 'outro' as 'programa', medicamentos: ['paracetamol'] },
        ],
      }),
    ).toMatchObject({ codigo: 'valor-nunca-visto' });
  });
  it('o medicamento fora da lista, fora do protocolo ou repetido é recusado', () => {
    expect(
      conferirReceitaEnfermeiro(
        { protocolo: 'PROT-DOR/2026', itens: [{ ...item, medicamento: 'amoxicilina' }] },
        o,
      ),
    ).toMatchObject({ codigo: 'fora-da-lista' });
    expect(
      conferirReceitaEnfermeiro(
        { protocolo: 'PROT-DOR/2026', itens: [{ ...item, medicamento: 'losartana' }] },
        o,
      ),
    ).toMatchObject({ codigo: 'fora-do-protocolo' });
    expect(
      conferirReceitaEnfermeiro(
        { protocolo: 'PROT-DOR/2026', itens: [item, { ...item, medicamento: ' paracetamol ' }] },
        o,
      ),
    ).toMatchObject({ codigo: 'medicamento-repetido' });
  });
});

describe('regra 17: o texto da receita (art. 3º) e a impressão', () => {
  const cab = {
    instituicao: 'ESTABELECIMENTO SINTETICO',
    cnpj: '00.000.000/0001-91',
    prescritor: 'ENFERMEIRA SINTETICA',
    coren: 'COREN-RJ 000000',
    categoria: 'Enfermeiro',
    paciente: 'PACIENTE SINTETICO',
    segundoIdentificador: '01/01/1980',
    data: '22/10/2026',
  };
  const r = {
    protocolo: { codigo: 'PROT-DOR', ano: 2026, tipo: 'institucional' as const },
    modelo: 'simples' as const,
    segundoIdentificador: 'nascimento' as const,
    listaVersao: 'ANEXO-II-SINT-1',
    itens: [{ ...item, medicamento: 'paracetamol' }],
  };
  it('leva o conteúdo mínimo: protocolo e ano, instituição e CNPJ, prescritor com COREN e categoria, data, paciente com o segundo identificador, genérico, via e posologia', async () => {
    const t = textoDaReceitaEnfermeiro(cab, r);
    for (const parte of [
      'Receita simples',
      'ESTABELECIMENTO SINTETICO · CNPJ 00.000.000/0001-91',
      'Protocolo institucional: PROT-DOR, de 2026',
      'Paciente: PACIENTE SINTETICO · Data de nascimento: 01/01/1980',
      '1. paracetamol · via oral · 20 comprimidos',
      '500 mg de 6 em 6 horas se dor',
      'Lista de medicamentos: ANEXO-II-SINT-1',
      'Data: 22/10/2026',
      'Prescritor: ENFERMEIRA SINTETICA · Enfermeiro · COREN-RJ 000000',
      'Assinatura eletrônica do prescritor',
    ])
      expect(t).toContain(parte);
    const retencao = textoDaReceitaEnfermeiro(
      { ...cab, cnpj: null, coren: null, segundoIdentificador: null },
      {
        ...r,
        modelo: 'retencao',
        segundoIdentificador: 'cpf',
        protocolo: { ...r.protocolo, tipo: 'programa' },
      },
    );
    expect(retencao).toContain('Receita de retenção');
    expect(retencao).toContain('Protocolo de programa de saúde');
    expect(retencao).toContain('CPF: não informado');
    expect(retencao).toContain('COREN não informado');
    expect(await impressaoDaReceita(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(await impressaoDaReceita(t)).not.toBe(await impressaoDaReceita(retencao));
  });
  it('o CPF sai mascarado', () => {
    expect(cpfMascarado('111.444.777-35')).toBe('111.***.***-35');
    expect(cpfMascarado('123')).toBeNull();
    expect(cpfMascarado(null)).toBeNull();
  });
});
