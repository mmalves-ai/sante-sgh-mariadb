// Regra 7 do M45 (etapa 4; ficha, seção 8: `sae.autorizacao.int-spec`): SAE, diagnóstico e prescrição de enfermagem são
// privativos do enfermeiro; o técnico executa e checa (COFEN 736/2024, arts. 6º e 7º). Pela HTTP, com as portas em
// memória (dados sintéticos): o médico com a opção de gravar a evolução tem a permissão e é recusado pela categoria
// (403 `so-enfermeiro`); o técnico não tem a permissão de registrar nem de prescrever, e checa o cuidado; o enfermeiro
// registra, prescreve e checa; quem não tem as opções da enfermagem não lê.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppEnfermagem, criarAppEnfermagem } from '../enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

const AT = 25_101;
const PROCESSO = {
  avaliacao: 'Avaliação sintética de teste da autorização do processo.',
  versaoVista: 0,
  diagnosticos: [
    {
      codigo: 'S-D02',
      fatores: ['S-F021'],
      resultados: [{ codigo: 'S-R02', escalaAtual: 3, meta: 2, escalaMeta: 3 }],
      intervencoes: [{ codigo: 'S-I02' }],
    },
  ],
};

describe('regra 7: quem faz o processo de enfermagem e quem checa', () => {
  it('o médico com a opção é recusado pela categoria; o técnico não registra; o enfermeiro registra e prescreve', async () => {
    const med = await a.entrar('SINT.MEDICO');
    const r = await a.post(med, `/enfermagem/sae/${AT}`, PROCESSO);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('so-enfermeiro');
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect((await a.post(tec, `/enfermagem/sae/${AT}`, PROCESSO)).statusCode).toBe(403);
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const ok = await a.post(enf, `/enfermagem/sae/${AT}`, PROCESSO);
    expect(ok.statusCode, ok.body).toBe(201);
    const p = (await a.get(enf, `/enfermagem/sae/${AT}`)).json();
    const iv = p.atual.diagnosticos[0].intervencoes[0];
    const cuidado = {
      versaoVista: 1,
      atividades: [
        {
          intervencao: iv.id,
          codigo: 'S-A021',
          descricao: 'Manter as grades do leito elevadas',
          frequenciaDia: 4,
          horarios: ['00:00', '06:00', '12:00', '18:00'],
          inicio: '2026-10-22T08:00',
        },
      ],
    };
    expect((await a.post(tec, `/enfermagem/sae/${AT}/cuidados`, cuidado)).statusCode).toBe(403);
    const pr = await a.post(med, `/enfermagem/sae/${AT}/cuidados`, cuidado);
    expect(pr.statusCode).toBe(403);
    expect(pr.json().codigo).toBe('so-enfermeiro');
    const feito = await a.post(enf, `/enfermagem/sae/${AT}/cuidados`, cuidado);
    expect(feito.statusCode, feito.body).toBe(201);
    // O técnico executa e checa o cuidado prescrito pelo enfermeiro.
    const atividade = feito.json().ids[0];
    const ch = await a.post(tec, `/enfermagem/sae/${AT}/cuidados/${atividade}/checagem`, {
      previsto: '2026-10-22T12:00',
      feita: true,
    });
    expect(ch.statusCode, ch.body).toBe(201);
    // O médico não checa (não tem a permissão da checagem da enfermagem).
    expect(
      (
        await a.post(med, `/enfermagem/sae/${AT}/cuidados/${atividade}/checagem`, {
          previsto: '2026-10-22T12:00',
          feita: true,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a tela informa o que a sessão pode; quem não tem as opções da enfermagem não lê', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const g = (await a.get(tec, `/enfermagem/sae/${AT}`)).json().gravacao;
    expect(g).toMatchObject({ enfermeiro: false, enfermagem: true });
    expect(g.operacoes.checar.pode).toBe(true);
    expect(g.operacoes.registrar.pode).toBe(false);
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, `/enfermagem/sae/${AT}`)).statusCode).toBe(403);
    expect((await a.get(fora, '/enfermagem/sae/turno?unidade=UTI')).statusCode).toBe(403);
  });
});
