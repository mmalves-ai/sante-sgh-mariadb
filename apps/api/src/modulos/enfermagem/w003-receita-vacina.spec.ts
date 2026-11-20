// W0-03 (programa CRUD completo) pela HTTP, com as portas em memória (dados sintéticos):
//   - receita do enfermeiro: suspender ou cancelar com o motivo e a senha; a original fica legível e inativa, com o mesmo
//     texto e a mesma impressão (nada é regerado); a reemissão aponta a anterior e só sai da inativa; o cancelamento é
//     de quem assinou; o técnico não suspende;
//   - vacina: estornar ou retificar com o motivo; o registro local fica; o evento RIA de cancelamento ou de substituição
//     entra na fila de saída; no dev, o destino da RNDS é o simulador e nenhuma chamada sai (fetch espionado).
import type { PrescricaoEnfermeiroDoAtendimento, VacinasDoPaciente } from '@sgh/contratos';
import { ambienteRnds, enderecosRnds } from '@sgh/dominio-integracao';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONSULTA_ENFERMAGEM_SINTETICA, PortaSaeMemoria } from './sae-porta-memoria.js';
import { PORTA_SAE } from './sae-porta.js';
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

async function assinar(s: Awaited<ReturnType<typeof a.entrar>>, extra: Record<string, unknown> = {}) {
  const pv = (await a.post(s, `${URL}/previa`, { ...RECEITA, ...extra })).json() as {
    impressao: string;
    texto: string;
  };
  const r = await a.post(s, URL, { ...RECEITA, ...extra, impressaoVista: pv.impressao, senha: SENHA });
  return { r, previa: pv };
}

describe('W0-03: receita do enfermeiro suspensa, cancelada e reemitida', () => {
  it('cancela com o motivo e a senha; a original fica legível e inativa, com o mesmo texto e a mesma impressão', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const { r, previa } = await assinar(enf);
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    const antes = ((await a.get(enf, URL)).json() as PrescricaoEnfermeiroDoAtendimento).receitas.find(
      (x) => x.id === id,
    )!;
    expect(antes.inativacao ?? null).toBeNull();

    // Sem motivo ou com a senha errada: nada muda.
    expect(
      (
        await a.post(enf, `${URL}/receitas/${id}/inativar`, {
          tipo: 'cancelamento',
          motivo: 'curto',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.post(enf, `${URL}/receitas/${id}/inativar`, {
          tipo: 'cancelamento',
          motivo: 'posologia digitada errada',
          senha: 'errada',
        })
      ).statusCode,
    ).toBe(401);
    // O técnico não suspende.
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (
        await a.post(tec, `${URL}/receitas/${id}/inativar`, {
          tipo: 'suspensao',
          motivo: 'paciente com reação ao medicamento',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);

    const ok = await a.post(enf, `${URL}/receitas/${id}/inativar`, {
      tipo: 'cancelamento',
      motivo: 'posologia digitada errada',
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = ((await a.get(enf, URL)).json() as PrescricaoEnfermeiroDoAtendimento).receitas.find(
      (x) => x.id === id,
    )!;
    expect(depois.inativacao).toMatchObject({
      tipo: 'cancelamento',
      motivo: 'posologia digitada errada',
      usuario: 'SINT.ENF.PLANTAO',
    });
    // A original não é regerada: o texto e a impressão assinados são os mesmos.
    expect(depois.impressao).toBe(antes.impressao);
    expect(depois.impressao).toBe(previa.impressao);
    expect(depois.texto).toBe(antes.texto);
    expect(depois.assinadaEm).toBe(antes.assinadaEm);
    // Uma vez só.
    const de_novo = await a.post(enf, `${URL}/receitas/${id}/inativar`, {
      tipo: 'suspensao',
      motivo: 'repetindo a suspensão',
      senha: SENHA,
    });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.json().codigo).toBe('receita-ja-inativa');
    const linha = a.trilha.eventos.find((e) => e.evento === 'enfermagem.prescricaoMedicamento.inativada');
    expect(linha).toBeDefined();
    expect(JSON.stringify(linha)).not.toContain('posologia digitada errada');
  });

  it('a reemissão aponta a anterior (inativa), cita-a no texto assinado e não se repete; a ativa não se reemite', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const ativa = (await assinar(enf)).r.json().id as number;
    const recusa = await a.post(enf, `${URL}/previa`, { ...RECEITA, anterior: ativa });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe('receita-ativa');

    await a.post(enf, `${URL}/receitas/${ativa}/inativar`, {
      tipo: 'suspensao',
      motivo: 'tratamento trocado na reavaliação',
      senha: SENHA,
    });
    const nova = await assinar(enf, { anterior: ativa });
    expect(nova.r.statusCode, nova.r.body).toBe(201);
    expect(nova.previa.texto).toContain(`Reemissão: substitui a receita nº ${ativa}`);
    const p = (await a.get(enf, URL)).json() as PrescricaoEnfermeiroDoAtendimento;
    const n = p.receitas.find((x) => x.id === nova.r.json().id)!;
    const o = p.receitas.find((x) => x.id === ativa)!;
    expect(n.anterior).toBe(ativa);
    expect(n.inativacao ?? null).toBeNull();
    expect(o.reemitidaEm).toBe(n.id);
    expect(o.inativacao?.tipo).toBe('suspensao');
    expect(n.impressao).not.toBe(o.impressao);
    // Uma reemissão por receita.
    const outra = await a.post(enf, `${URL}/previa`, { ...RECEITA, anterior: ativa });
    expect(outra.statusCode).toBe(409);
    expect(outra.json().codigo).toBe('receita-ja-reemitida');
  });
});

const AT = 25_103;
const VACINA = {
  imunobiologico: '99',
  lote: 'LOTE-W003-1',
  fabricante: 'Fabricante sintético',
  validadeLote: '2027-01-31',
  dose: 'D1',
  via: 'IM',
  local: 'DD',
};

describe('W0-03: vacina estornada ou retificada, com o RIA de cancelamento ou substituição na fila', () => {
  it('retifica e depois estorna: o registro local fica; cada correção põe o evento na fila; nenhuma chamada sai', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    try {
      const enf = await a.entrar('SINT.ENF.PLANTAO');
      const reg = await a.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
      expect(reg.statusCode, reg.body).toBe(201);
      const id = reg.json().id as number;
      const porta = a.app.get<PortaSaeMemoria>(PORTA_SAE);
      const antes = porta.fila('aa').length;

      // Retificação sem dados, ou com motivo curto: recusa.
      expect(
        (
          await a.post(enf, `/enfermagem/vacinas/${AT}/${id}/corrigir`, {
            tipo: 'retificacao',
            motivo: 'lote digitado errado',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await a.post(enf, `/enfermagem/vacinas/${AT}/${id}/corrigir`, {
            tipo: 'estorno',
            motivo: 'curto',
          })
        ).statusCode,
      ).toBe(400);

      const ret = await a.post(enf, `/enfermagem/vacinas/${AT}/${id}/corrigir`, {
        tipo: 'retificacao',
        motivo: 'lote digitado errado na aplicação',
        dados: { lote: 'LOTE-W003-2' },
      });
      expect(ret.statusCode, ret.body).toBe(200);
      let v = ((await a.get(enf, `/enfermagem/vacinas/${AT}`)).json() as VacinasDoPaciente).vacinas.find(
        (x) => x.id === id,
      )!;
      expect(v).toMatchObject({
        situacao: 'retificada',
        lote: 'LOTE-W003-2',
        original: { lote: 'LOTE-W003-1' },
      });
      expect(v.correcoes?.[0]).toMatchObject({
        versao: 1,
        tipo: 'retificacao',
        motivo: 'lote digitado errado na aplicação',
      });
      // A prévia RIA é a da versão vigente.
      const ria = (await a.get(enf, `/enfermagem/vacinas/${AT}/${id}/ria`)).json();
      expect(ria.recurso).toMatchObject({ status: 'completed', lotNumber: 'LOTE-W003-2' });

      const est = await a.post(enf, `/enfermagem/vacinas/${AT}/${id}/corrigir`, {
        tipo: 'estorno',
        motivo: 'registrada no paciente errado',
      });
      expect(est.statusCode, est.body).toBe(200);
      v = ((await a.get(enf, `/enfermagem/vacinas/${AT}`)).json() as VacinasDoPaciente).vacinas.find(
        (x) => x.id === id,
      )!;
      expect(v.situacao).toBe('estornada');
      expect(v.correcoes?.map((c) => `${c.versao}:${c.tipo}`)).toEqual(['1:retificacao', '2:estorno']);
      expect((await a.get(enf, `/enfermagem/vacinas/${AT}/${id}/ria`)).json().recurso.status).toBe(
        'entered-in-error',
      );
      // Depois do estorno, nada mais.
      const mais = await a.post(enf, `/enfermagem/vacinas/${AT}/${id}/corrigir`, {
        tipo: 'retificacao',
        motivo: 'tentando corrigir de novo',
        dados: { local: 'DE' },
      });
      expect(mais.statusCode).toBe(409);
      expect(mais.json().codigo).toBe('vacina-estornada');
      // Revisão W0-03: a dose estornada não ocupa a chave — a D1 aplicada de fato é relançada.
      const relanca = await a.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
      expect(relanca.statusCode, relanca.body).toBe(201);
      const relancada = relanca.json().id as number;
      // A D1 vigente (a relançada) recusa uma segunda D1.
      const dup = await a.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
      expect(dup.statusCode).toBe(409);
      expect(dup.json().codigo).toBe('dose-ja-registrada');
      // Digitada D2 por engano e retificada para D1: recusada (a D1 vigente é a relançada); retificada para D3, a D2
      // real passa a ser aceita.
      const d2 = await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, dose: 'D2' });
      expect(d2.statusCode, d2.body).toBe(201);
      const paraD1 = await a.post(enf, `/enfermagem/vacinas/${AT}/${d2.json().id}/corrigir`, {
        tipo: 'retificacao',
        motivo: 'dose digitada errada na aplicação',
        dados: { dose: 'D1' },
      });
      expect(paraD1.statusCode).toBe(409);
      expect(paraD1.json().codigo).toBe('dose-ja-registrada');
      expect(
        (
          await a.post(enf, `/enfermagem/vacinas/${AT}/${d2.json().id}/corrigir`, {
            tipo: 'retificacao',
            motivo: 'dose digitada errada na aplicação',
            dados: { dose: 'D3' },
          })
        ).statusCode,
      ).toBe(200);
      expect((await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, dose: 'D2' })).statusCode).toBe(
        201,
      );
      expect(relancada).toBeGreaterThan(id);

      // A fila de saída: a substituição e o cancelamento, com carga só de IDs.
      const novos = porta
        .fila('aa')
        .slice(antes)
        .filter((x) => x.tipo !== 'fato.vacina.aplicada');
      expect(novos.map((x) => x.tipo)).toEqual([
        'fato.vacina.substituida',
        'fato.vacina.cancelada',
        'fato.vacina.substituida',
      ]);
      for (const x of novos) expect(Object.keys(x.carga).sort()).toEqual(['paciente', 'vacina', 'versao']);
      expect(a.trilha.eventos.filter((e) => e.evento === 'enfermagem.vacina.corrigida')).toHaveLength(3);
      expect(JSON.stringify(a.trilha.eventos)).not.toContain('registrada no paciente errado');

      // No dev o destino da RNDS é o simulador local; nenhuma chamada saiu durante as correções.
      expect(ambienteRnds('dev', false)).toBe('simulador');
      expect(ambienteRnds('dev', true)).toBe('simulador');
      expect(() => enderecosRnds('simulador', 'https://ehr-services.hmg.saude.gov.br')).toThrow(
        /endereço local/,
      );
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      espiao.mockRestore();
    }
  });

  it('o técnico corrige (é vacinador); quem não é da enfermagem não', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const reg = await a.post(tec, `/enfermagem/vacinas/${AT}`, { ...VACINA, imunobiologico: '98' });
    expect(reg.statusCode, reg.body).toBe(201);
    const r = await a.post(tec, `/enfermagem/vacinas/${AT}/${reg.json().id}/corrigir`, {
      tipo: 'retificacao',
      motivo: 'local de aplicação trocado',
      dados: { local: 'DE' },
    });
    expect(r.statusCode, r.body).toBe(200);
    const fora = await a.entrar('SINT.AGENDA');
    expect(
      (
        await a.post(fora, `/enfermagem/vacinas/${AT}/${reg.json().id}/corrigir`, {
          tipo: 'estorno',
          motivo: 'tentativa de quem não é da enfermagem',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('W0-03 M6: o monitor de recusas do RIA', () => {
  it('lista as recusas do estabelecimento com o motivo e o destino (dev: o simulador); a leitura vai à trilha', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const vazio = await a.get(enf, '/enfermagem/vacinas/rnds/recusas');
    expect(vazio.statusCode, vazio.body).toBe(200);
    expect(vazio.json()).toMatchObject({ recusas: [], destino: 'simulador' });
    const porta = a.app.get<PortaSaeMemoria>(PORTA_SAE);
    porta.simularRecusaRia({ rede: 'sintetica', hospital: 'aa' } as never, {
      envio: 91,
      evento: 'substituida',
      vacina: 7,
      versao: 1,
      situacao: 'morto',
      tentativas: 8,
      motivo: 'recusado pela RNDS (HTTP 422): business-rule: Lote *** inexistente',
      proximaTentativaEm: null,
      mortoEm: '2031-01-06T12:00',
      criadoEm: '2031-01-06T10:00',
    });
    const antes = a.trilha.eventos.length;
    const r = (await a.get(enf, '/enfermagem/vacinas/rnds/recusas')).json();
    expect(r.recusas).toEqual([
      expect.objectContaining({ envio: 91, evento: 'substituida', situacao: 'morto', vacina: 7, versao: 1 }),
    ]);
    expect(r.recusas[0].motivo).toContain('Lote ***');
    expect(a.trilha.eventos.slice(antes)).toContainEqual(
      expect.objectContaining({ evento: 'enfermagem.vacina.lida', tabelaAlvo: 'SGH_INTG_ENVIO' }),
    );
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, '/enfermagem/vacinas/rnds/recusas')).statusCode).toBe(403);
  });
});
