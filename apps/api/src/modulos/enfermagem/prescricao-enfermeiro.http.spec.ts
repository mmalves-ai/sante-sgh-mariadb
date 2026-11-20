// Regra 17 do M45 (etapa 4; Res. COFEN 801/2026) pela HTTP, com as portas em memória (dados sintéticos): as consultas
// de enfermagem do dia do enfermeiro; a consulta com os protocolos publicados e a lista do anexo II; a prévia com o
// conteúdo mínimo do art. 3º e a impressão; a assinatura com a senha (a impressão vista tem de ser a recalculada); fora
// da consulta de enfermagem, do protocolo ou da lista, recusa; o técnico e o médico não prescrevem; a chave desligada
// pelo administrador recusa.
import type { PrescricaoEnfermeiroDoAtendimento, PreviaReceitaEnfermeiro } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSULTA_ENFERMAGEM_SINTETICA, CONSULTA_MEDICA_SINTETICA } from './sae-porta-memoria.js';
import { montarAppSae, SENHA } from './sae.spec-util.js';

let a: Awaited<ReturnType<typeof montarAppSae>>;
beforeAll(async () => {
  a = await montarAppSae();
});
afterAll(async () => {
  await a.app.close();
});

const URL = `/enfermagem/prescricao-medicamento/${CONSULTA_ENFERMAGEM_SINTETICA}`;
const RECEITA = {
  protocolo: 'PROT-SINT-DOR/2026',
  modelo: 'simples',
  segundoIdentificador: 'nascimento',
  itens: [
    {
      medicamento: 'Paracetamol',
      via: 'oral',
      posologia: '500 mg de 6 em 6 horas se dor',
      quantidade: '20 comprimidos',
    },
  ],
};

describe('regra 17: a prescrição de medicamento pelo enfermeiro', () => {
  it('as consultas do dia do enfermeiro; a consulta com os protocolos e a lista; o médico da consulta não é enfermeiro', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const cs = (await a.get(enf, '/enfermagem/prescricao-medicamento/consultas')).json();
    expect(cs.map((c: { atendimento: number }) => c.atendimento)).toEqual([CONSULTA_ENFERMAGEM_SINTETICA]);
    // A lista com nome e registro dos pacientes do dia deixa a linha de leitura na trilha (só a contagem no alvo).
    const lida = a.trilha.eventos.filter(
      (l) => l.evento === 'enfermagem.prescricaoMedicamento.lida' && l.tabelaAlvo === 'ATCABECATEND',
    );
    expect(lida).toHaveLength(1);
    expect(lida[0]).toMatchObject({ usuario: 'SINT.ENF.PLANTAO', resultado: 'sucesso' });
    expect(lida[0]?.chaveNaturalAlvo).toMatch(/^dia:\d{4}-\d{2}-\d{2};n:1$/);
    const p = (await a.get(enf, URL)).json() as PrescricaoEnfermeiroDoAtendimento;
    expect(p).toMatchObject({
      consultaDeEnfermagem: true,
      gravacao: { ligada: true, enfermeiro: true, prescrever: true },
    });
    expect(p.protocolos.map((x) => `${x.codigo}/${x.ano}:${x.tipo}`)).toEqual([
      'PROT-SINT-DOR/2026:institucional',
      'PROT-SINT-HAS/2026:programa',
    ]);
    expect(p.lista?.versao).toBe('ANEXO-II-SINT-1');
    const med = (await a.get(enf, `/enfermagem/prescricao-medicamento/${CONSULTA_MEDICA_SINTETICA}`)).json();
    expect(med).toMatchObject({ consultaDeEnfermagem: false, gravacao: { prescrever: false } });
    expect(med.motivo).toMatch(/não é enfermeiro/);
    const internado = (await a.get(enf, '/enfermagem/prescricao-medicamento/25101')).json();
    expect(internado.consultaDeEnfermagem).toBe(false);
    expect(internado.motivo).toMatch(/não é uma consulta externa/);
    expect((await a.get(enf, '/enfermagem/prescricao-medicamento/99999')).statusCode).toBe(404);
  });

  it('a prévia com o conteúdo mínimo e a assinatura com a senha; a impressão vista diferente recusa', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const pv = await a.post(enf, `${URL}/previa`, RECEITA);
    expect(pv.statusCode, pv.body).toBe(200);
    const previa = pv.json() as PreviaReceitaEnfermeiro;
    for (const parte of [
      'Receita simples',
      'CNPJ 00000000000191',
      'Protocolo institucional: PROT-SINT-DOR, de 2026',
      'Data de nascimento: 01/01/1980',
      '1. paracetamol · via oral · 20 comprimidos',
      'Lista de medicamentos: ANEXO-II-SINT-1',
      'Data: 22/10/2026',
      'COREN-RJ 000000',
    ])
      expect(previa.texto).toContain(parte);
    const errada = await a.post(enf, URL, { ...RECEITA, impressaoVista: '0'.repeat(64), senha: SENHA });
    expect(errada.statusCode).toBe(409);
    expect(errada.json().codigo).toBe('receita-mudou');
    const semSenha = await a.post(enf, URL, {
      ...RECEITA,
      impressaoVista: previa.impressao,
      senha: 'errada',
    });
    expect(semSenha.statusCode).toBe(401);
    const ok = await a.post(enf, URL, { ...RECEITA, impressaoVista: previa.impressao, senha: SENHA });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().impressao).toBe(previa.impressao);
    const lida = (await a.get(enf, URL)).json() as PrescricaoEnfermeiroDoAtendimento;
    expect(lida.receitas).toHaveLength(1);
    expect(lida.receitas[0]).toMatchObject({ protocolo: 'PROT-SINT-DOR', impressao: previa.impressao });
    expect(lida.receitas[0]!.texto).toBe(previa.texto);
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.prescricaoMedicamento.assinada')).toBe(true);
  });

  it('fora do protocolo, fora da lista, protocolo não publicado e fora da consulta de enfermagem: recusa', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const com = (x: Record<string, unknown>) => a.post(enf, `${URL}/previa`, { ...RECEITA, ...x });
    expect((await com({ itens: [{ ...RECEITA.itens[0], medicamento: 'losartana' }] })).json().codigo).toBe(
      'fora-do-protocolo',
    );
    expect((await com({ itens: [{ ...RECEITA.itens[0], medicamento: 'amoxicilina' }] })).json().codigo).toBe(
      'fora-da-lista',
    );
    expect((await com({ protocolo: 'PROT-X/2026' })).json().codigo).toBe('protocolo-nao-publicado');
    const fora = await a.post(
      enf,
      `/enfermagem/prescricao-medicamento/${CONSULTA_MEDICA_SINTETICA}/previa`,
      RECEITA,
    );
    expect(fora.json().codigo).toBe('fora-da-consulta-de-enfermagem');
  });

  it('o técnico e o médico não prescrevem; a chave desligada recusa', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect((await a.post(tec, `${URL}/previa`, RECEITA)).statusCode).toBe(403);
    const med = await a.entrar('SINT.MEDICO');
    const m = await a.post(med, `${URL}/previa`, RECEITA);
    expect(m.statusCode).toBe(403);
    expect(m.json().codigo).toBe('so-enfermeiro');
    const b = await montarAppSae({ semChave: 'enfermagem.prescricaoMedicamento' });
    try {
      const enf = await b.entrar('SINT.ENF.PLANTAO');
      const p = (await b.get(enf, URL)).json();
      expect(p.gravacao).toMatchObject({ ligada: false, prescrever: false });
      const r = await b.post(enf, URL, { ...RECEITA, impressaoVista: 'a'.repeat(64), senha: SENHA });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.app.close();
    }
  });
});
