// W1-08: o estorno da checagem e o aprazamento pela API gravam no horário (executor; memória com as mesmas recusas).
// O estorno da dose que baixou estoque é recusado (409 estoque-baixado) e segue com a devolução pendente; o reaprazar
// substitui a hora do horário. Dados sintéticos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
  SENHA,
} from './enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

describe('W1-08: estorno da checagem e aprazamento no horário', () => {
  it('o estorno da dose com baixa de estoque avisa e oferece a devolução; com a devolução pendente, estorna', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const morfina = t.horarios.find((x) => x.altaVigilancia && x.situacao === 'P')!;
    const ch = await a.post(
      s,
      `/enfermagem/horarios/${morfina.id}/checar`,
      checagemPadrao(25002, 25202, { conferente: { login: 'SINT.ENF.APOIO', senha: SENHA } }),
    );
    expect(ch.statusCode).toBe(200);
    const corpo = { motivo: 'nao-administrado', justificativa: 'dose não foi administrada ao paciente' };
    const recusa = await a.post(s, `/enfermagem/horarios/${morfina.id}/estornar`, corpo);
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe('estoque-baixado');
    expect(recusa.json().detail).toMatch(/Devolva a dose agora ou estorne/);
    const ainda = await horariosDaUti(a, s);
    expect(ainda.horarios.find((x) => x.id === morfina.id)?.situacao).toBe('A');
    const ok = await a.post(s, `/enfermagem/horarios/${morfina.id}/estornar`, {
      ...corpo,
      devolucaoPendente: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ situacao: 'P', devolucaoPendente: true });
    expect(ok.json().mensagem).toMatch(/devolução da dose pendente/);
    const depois = await horariosDaUti(a, s);
    expect(depois.horarios.find((x) => x.id === morfina.id)?.situacao).toBe('P');
    // Estornado não se estorna de novo (nada a estornar).
    const de2 = await a.post(s, `/enfermagem/horarios/${morfina.id}/estornar`, corpo);
    expect(de2.statusCode).toBe(409);
    expect(de2.json().codigo).toBe('horario-nao-checado');
  });

  it('o reaprazar substitui a hora no horário; o motivo do estorno fora da lista recusa', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const p = (await a.get(s, '/enfermagem/aprazamento?unidade=UTI')).json();
    const x = p.itens.find((i: { horario: number }) => i.horario > 0);
    const nova = `${x.proposto.slice(0, 11)}${x.proposto.slice(11, 13) === '23' ? '22' : '23'}:30`;
    const r = await a.post(s, '/enfermagem/aprazamento', {
      itens: [
        {
          horario: x.horario,
          acao: 'reaprazar',
          proposto: x.proposto,
          confirmado: nova,
          motivo: 'paciente em exame de imagem',
        },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ gravados: 1, registrados: 1 });
    const p2 = (await a.get(s, '/enfermagem/aprazamento?unidade=UTI')).json();
    const y = p2.itens.find((i: { horario: number }) => i.horario === x.horario);
    expect(y?.registrado?.acao ?? 'reaprazar').toBe('reaprazar');
    const d = (await a.get(s, `/enfermagem/horarios/${x.horario}`)).json();
    expect(String(d.horario.previsto).slice(0, 16)).toBe(nova);
    const motivoErrado = await a.post(s, `/enfermagem/horarios/${x.horario}/estornar`, {
      motivo: 'outro',
      justificativa: 'motivo fora da lista do estorno',
    });
    expect(motivoErrado.statusCode).toBe(400);
  });
});
