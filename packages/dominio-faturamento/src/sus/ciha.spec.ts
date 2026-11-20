// Regra 3 do M51: a CIHA cobre o não SUS, com o SIGTAP equivalente, o CID principal e os dados mínimos; o item sem
// equivalente vai para a crítica. Massa sintética.
import { describe, expect, it } from 'vitest';
import { chaveDaCritica, montarCiha, normalizarCid, resumoCriticas } from './ciha.js';
import { atendimento, CATALOGO, cnsSintetico, contexto } from './massa.spec-util.js';

const paciente = (x: Record<string, unknown>) => ({ ...atendimento().paciente, ...x });

const regras = (r: ReturnType<typeof montarCiha>) => r.criticas.map((c) => c.regra);

describe('CIHA (regra 3)', () => {
  it('convênio e particular entram; o SUS fica fora (vai para BPA, APAC ou AIH)', () => {
    const r = montarCiha(
      [atendimento({ convenio: 20 }), atendimento({ convenio: 10 }), atendimento({ convenio: 1 })],
      contexto(),
    );
    expect(r.registros.map((x) => x.fonte)).toEqual(['plano-privado', 'particular-pf']);
    expect(r.foraPorSerSus).toBe(1);
    expect(r.criticas).toEqual([]);
  });

  it('item sem equivalente SIGTAP: crítica bloqueante se nenhum tem; aviso se outros têm', () => {
    const sem = atendimento({ itens: [{ item: 1, sigtap: null, quantidade: 1 }] });
    const parcial = atendimento({
      itens: [
        { item: 2, sigtap: 101, quantidade: 1 },
        { item: 3, sigtap: null, quantidade: 2 },
      ],
    });
    const r = montarCiha([sem, parcial], contexto());
    expect(r.criticas).toMatchObject([
      { regra: 'sem-sigtap', gravidade: 'bloqueante', conta: sem.conta, detalhe: { itens: 1 } },
      { regra: 'item-sem-sigtap', gravidade: 'aviso', conta: parcial.conta, detalhe: { itens: 1 } },
    ]);
    expect(r.registros.map((x) => x.conta)).toEqual([parcial.conta]);
    expect(resumoCriticas(r.criticas)).toEqual({
      bloqueantes: 1,
      avisos: 1,
      porRegra: { 'sem-sigtap': 1, 'item-sem-sigtap': 1 },
    });
  });

  it('procedimento fora da competência e inexistente: bloqueante, sem repetir "sem SIGTAP"', () => {
    const r = montarCiha(
      [
        atendimento({ itens: [{ item: 1, sigtap: 103, quantidade: 1 }] }),
        atendimento({ itens: [{ item: 2, sigtap: 999, quantidade: 1 }] }),
      ],
      contexto(),
    );
    expect(regras(r)).toEqual(['sigtap-fora-da-competencia', 'sigtap-fora-da-competencia']);
    expect(r.criticas[0]!.detalhe).toEqual({
      sigtap: '0211020036',
      competencia: '202509',
      procedimento: null,
    });
    expect(r.criticas[1]!.detalhe).toEqual({ sigtap: 999, competencia: '202509', procedimento: null });
    expect(r.registros).toEqual([]);
  });

  it('CID, identificação, dados mínimos, fonte e data da competência', () => {
    const r = montarCiha(
      [
        atendimento({ cidPrincipal: null }),
        atendimento({ cidPrincipal: 'I1' }),
        atendimento({ paciente: paciente({ cns: null, cpf: null, sexo: 'X', nascimento: null }) }),
        atendimento({ convenio: 99 }),
        atendimento({ saida: '2025-10-01' }),
      ],
      contexto(),
    );
    expect(regras(r)).toEqual([
      'sem-cid-principal',
      'cid-invalido',
      'sem-identificacao',
      'dado-minimo-ausente',
      'dado-minimo-ausente',
      'fonte-remuneracao-indefinida',
      'data-fora-da-competencia',
    ]);
    expect(r.registros).toEqual([]);
  });

  it('CID inexistente pela tabela, quando o contexto confere', () => {
    const r = montarCiha(
      [atendimento({ cidPrincipal: 'Z999' })],
      contexto({ cidExiste: (c) => c !== 'Z999' }),
    );
    expect(regras(r)).toEqual(['cid-invalido']);
  });

  it('compatibilidade com a SIGTAP da competência (sexo, idade, quantidade)', () => {
    const r = montarCiha(
      [
        atendimento({
          paciente: paciente({ cns: cnsSintetico(1), cpf: null, sexo: 'M', nascimento: '2020-01-01' }),
          itens: [{ item: 1, sigtap: 102, quantidade: 2 }],
        }),
      ],
      contexto(),
    );
    expect(regras(r)).toEqual(['sexo-incompativel', 'idade-incompativel', 'quantidade-acima-do-maximo']);
    expect(r.registros).toEqual([]);
  });

  it('CNES ausente é crítica do estabelecimento (no dev, TBEMPHOS.CNES está zerado)', () => {
    const r = montarCiha([], contexto({ cnes: 0 }));
    expect(r.criticas).toMatchObject([{ regra: 'sem-cnes', conta: null, atendimento: null }]);
  });

  it('agrupa por código; na internação o principal é o de maior quantidade', () => {
    const r = montarCiha(
      [
        atendimento({
          modalidade: 'internacao',
          entrada: '2025-08-28',
          saida: '2025-09-02',
          cidSecundario: 'e11.9',
          itens: [
            { item: 1, sigtap: 101, quantidade: 1 },
            { item: 2, sigtap: 102, quantidade: 1 },
            { item: 3, sigtap: 101, quantidade: 1 },
          ],
        }),
      ],
      contexto(),
    );
    expect(r.criticas).toEqual([]);
    expect(r.registros[0]).toMatchObject({
      modalidade: 'internacao',
      entrada: '2025-08-28',
      saida: '2025-09-02',
      cidSecundario: 'E119',
      motivoAlta: 12,
      // Só o procedimento que caracteriza a internação (sem o registro conhecido, o de maior quantidade), com 1.
      procedimentos: [{ codigo: '0301010072', quantidade: 1, consolidado: false }],
    });
  });

  it('internação: prefere o procedimento de registro "AIH principal"; ambulatorial: BPA-C vai consolidado', () => {
    const ctx = contexto({
      procedimento: (id) => {
        const p = CATALOGO.get(id);
        if (!p) return null;
        const registros = id === 102 ? (['aih-principal'] as const) : (['bpa-c'] as const);
        return { procedimento: p, naCompetencia: { fonte: 'atual', atributos: p.atuais }, registros };
      },
    });
    const r = montarCiha(
      [
        atendimento({
          modalidade: 'internacao',
          itens: [
            { item: 1, sigtap: 101, quantidade: 5 },
            { item: 2, sigtap: 102, quantidade: 1 },
          ],
        }),
        atendimento({ itens: [{ item: 3, sigtap: 101, quantidade: 4 }] }),
      ],
      ctx,
    );
    expect(r.criticas).toEqual([]);
    expect(r.registros[0]!.procedimentos).toEqual([
      { codigo: '0310010039', quantidade: 1, consolidado: false },
    ]);
    expect(r.registros[1]!.procedimentos).toEqual([
      { codigo: '0301010072', quantidade: 4, consolidado: true },
    ]);
  });

  it('equivalência registrada no Sante: vale sem vínculo ou com o vínculo fora da competência; o vigente prevalece', () => {
    const equivalencia = (procto: number) => (procto === 7001 ? 101 : null);
    const r = montarCiha(
      [
        atendimento({ itens: [{ item: 1, sigtap: null, quantidade: 1, procedimento: 7001 }] }),
        atendimento({ itens: [{ item: 2, sigtap: 103, quantidade: 1, procedimento: 7001 }] }),
        atendimento({ itens: [{ item: 3, sigtap: 102, quantidade: 1, procedimento: 7001 }] }),
        atendimento({ itens: [{ item: 4, sigtap: null, quantidade: 1, procedimento: 7002 }] }),
      ],
      contexto({ equivalencia }),
    );
    expect(r.registros.map((x) => x.procedimentos[0]?.codigo)).toEqual([
      '0301010072',
      '0301010072',
      '0310010039',
    ]);
    expect(r.criticas).toMatchObject([{ regra: 'sem-sigtap', detalhe: { itens: 1, procedimentos: '7002' } }]);
  });

  it('campos que o leiaute exige: endereço, prontuário, motivo da alta e os da operadora do plano', () => {
    const r = montarCiha(
      [
        atendimento({
          paciente: paciente({ nome: ' ', logradouro: null, municipio: 0, uf: 'R', cep: '0', prontuario: 0 }),
        }),
        atendimento({ modalidade: 'internacao', motivoAlta: 99, beneficiario: null, operadora: null }),
        atendimento({ convenio: 30 }),
      ],
      contexto({
        fontePorConvenio: (c) => (c === 30 ? 'consorcio-publico' : 'plano-privado'),
      }),
    );
    expect(r.criticas.map((c) => c.detalhe['campo'])).toEqual([
      'nome',
      'logradouro',
      'municipio',
      'uf',
      'cep',
      'prontuario',
      'motivoAlta',
      'regAns',
      'beneficiario',
      'cnpjOperadora',
    ]);
    expect(new Set(regras(r))).toEqual(new Set(['dado-minimo-ausente']));
  });

  it('óbito leva a declaração; fora da fonte plano privado, ANS, beneficiário e guia não vão', () => {
    const r = montarCiha(
      [
        atendimento({
          modalidade: 'internacao',
          motivoAlta: 41,
          paciente: paciente({ declaracaoObito: '12345678901' }),
        }),
        atendimento({ convenio: 10 }),
      ],
      contexto(),
    );
    expect(r.registros[0]).toMatchObject({ declaracaoObito: '12345678901', regAns: 123456 });
    expect(r.registros[1]).toMatchObject({
      regAns: null,
      beneficiario: null,
      guiaTiss: null,
      motivoAlta: null,
    });
  });

  it('a chave da crítica é estável entre execuções (ordem do detalhe não importa)', () => {
    const base = { regra: 'sem-sigtap' as const, conta: 1, atendimento: 2, item: null };
    expect(chaveDaCritica({ ...base, detalhe: { a: 1, b: 'x' } })).toBe(
      chaveDaCritica({ ...base, detalhe: { b: 'x', a: 1 } }),
    );
    expect(chaveDaCritica({ ...base, detalhe: {} })).toBe('sem-sigtap|1|2||');
  });

  it('normaliza o CID', () => {
    expect(normalizarCid(' i10. ')).toBe('I10');
    expect(normalizarCid('')).toBeNull();
    expect(normalizarCid(null)).toBeNull();
  });
});
