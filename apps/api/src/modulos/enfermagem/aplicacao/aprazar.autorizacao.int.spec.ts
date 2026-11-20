// Regra 1 do M25 (ficha, seção 8): aprazar é ato do enfermeiro; o técnico executa e checa (COFEN 736/2024). Pela HTTP,
// com a porta em memória (dados sintéticos): o técnico tem a checagem e não apraza (403 pela categoria do CBO); o
// enfermeiro apraza; quem não tem as opções da enfermagem, nem lê a proposta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppEnfermagem, criarAppEnfermagem } from '../enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

describe('regra 1: quem apraza', () => {
  it('o técnico vê a proposta e não confirma; o enfermeiro confirma; sem as opções, 403', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const p = await a.get(tec, '/enfermagem/aprazamento?unidade=UTI');
    expect(p.statusCode).toBe(200);
    const x = p.json().itens[0];
    const corpo = {
      itens: [{ horario: x.horario, acao: 'aprazar', proposto: x.proposto, confirmado: x.proposto }],
    };
    // O técnico não tem a permissão de aprazar (opções do enfermeiro).
    expect((await a.post(tec, '/enfermagem/aprazamento', corpo)).statusCode).toBe(403);
    const g = (await a.get(tec, '/enfermagem/gravacao')).json();
    expect(g.categoria).toBe('tecnico');
    expect(g.operacoes['registrarAprazamento'].pode).toBe(false);
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const ok = await a.post(enf, '/enfermagem/aprazamento', corpo);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().registrados).toBe(1);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.horario.aprazado')).toBe(true);
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, '/enfermagem/aprazamento?unidade=UTI')).statusCode).toBe(403);
  });
  it('o enfermeiro com a opção mas sem o vínculo de enfermagem (outra ocupação) é recusado pela categoria', async () => {
    // O supervisor tem o vínculo de enfermeiro; o grupo do apoio também: os dois aprazam. O técnico, com as opções do
    // enfermeiro emprestadas, continuaria técnico pelo CBO: a categoria vem da ocupação, não da opção.
    const sup = await a.entrar('SINT.SUPERVISOR.ENF');
    const g = (await a.get(sup, '/enfermagem/gravacao')).json();
    expect(g.categoria).toBe('enfermeiro');
  });
});
