// Regra 7 do M25 (ficha, seção 8): dupla checagem do item de alta vigilância (a marca do M24) e do hemocomponente: o
// segundo profissional com o login próprio, diferente do primeiro, com a senha conferida e a permissão de conferir.
// Pela HTTP, com a porta em memória (dados sintéticos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
  SENHA,
} from '../enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

describe('regra 7: dupla checagem', () => {
  it('sem o segundo, com o mesmo login, com quem não confere ou com a senha errada: recusa; com o segundo: grava', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const morfina = t.horarios.find((x) => x.altaVigilancia)!;
    expect(morfina).toBeTruthy();
    const url = `/enfermagem/horarios/${morfina.id}/checar`;
    const tentar = (conferente: unknown) =>
      a.post(s, url, checagemPadrao(25002, 25202, conferente ? { conferente } : {}));
    const sem = await tentar(null);
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('dupla-checagem');
    expect(sem.json().detail).toMatch(/segundo profissional/);
    expect((await tentar({ login: 'SINT.ENF.PLANTAO', senha: SENHA })).json().detail).toMatch(/outra pessoa/);
    expect((await tentar({ login: 'SINT.TECNICO.ENF', senha: SENHA })).json().detail).toMatch(
      /permissão de conferir/,
    );
    expect((await tentar({ login: 'SINT.ENF.APOIO', senha: 'errada#1' })).json().detail).toMatch(
      /não conferiu/,
    );
    const ok = await tentar({ login: 'SINT.ENF.APOIO', senha: SENHA });
    expect(ok.statusCode).toBe(200);
    const d = (await a.get(s, `/enfermagem/horarios/${morfina.id}`)).json();
    expect(d.atos[0].conferente).toBe('SINT.ENF.APOIO');
  });
});
