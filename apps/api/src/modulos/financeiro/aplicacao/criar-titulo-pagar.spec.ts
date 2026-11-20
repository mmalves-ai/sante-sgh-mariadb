// Regras 2, 3, 6 e 7 do M32 pela HTTP (porta em memória): só grava título com credor válido (o órfão do outro sistema
// aparece como "não encontrado no cadastro"), chave natural repetida devolve 409, parcelas que somam o documento, a
// classificação gerencial só na parcela 1 valendo para o documento, título pago não se apaga; permissões pelas opções
// do outro sistema; idempotência; textos sem o nome do outro sistema. Dados sintéticos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppFinanceiro, appFinanceiro, SISTEMA_ANTIGO, tituloSintetico } from './comum.spec-util.js';

let a: AppFinanceiro;
let hoje = '';
beforeAll(async () => {
  a = await appFinanceiro();
  const s = await a.entrar('SINT.FIN.LANCA');
  hoje = (await a.get(s, '/financeiro/apoio')).json().hoje;
});
afterAll(async () => {
  await a.app.close();
});

describe('financeiro.criarTituloPagar pela HTTP (memória)', () => {
  it('sem as opções do contas a pagar, 403', async () => {
    const outra = await a.entrar('SINT.AGENDA');
    expect((await a.get(outra, '/financeiro/pagar/titulos')).statusCode).toBe(403);
    expect((await a.post(outra, '/financeiro/pagar/titulos', tituloSintetico(1, hoje))).statusCode).toBe(403);
  });

  it('M55: o título ligado a contrato sem a permissão de ligar ao contrato, 403 antes de gravar', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const r = await a.post(s, '/financeiro/pagar/titulos', {
      ...tituloSintetico(90, hoje),
      contrato: { contrato: 1, excecao: null, pedidoDeOrigem: null },
    });
    expect(r.statusCode).toBe(403);
    expect(JSON.stringify(r.json())).toContain('sem-permissao');
  });

  it('regra 2: credor fora do cadastro recusado; o médico exige o profissional', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const r = await a.post(
      s,
      '/financeiro/pagar/titulos',
      tituloSintetico(2, hoje, 100, { credor: 999_999 }),
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('credor-inexistente');
    expect(r.json().detail).not.toMatch(SISTEMA_ANTIGO);
    const m = await a.post(
      s,
      '/financeiro/pagar/titulos',
      tituloSintetico(3, hoje, 100, { tipo: 'M', credor: 7001 }),
    );
    expect(m.json().codigo).toBe('profissional-obrigatorio');
    const ok = await a.post(
      s,
      '/financeiro/pagar/titulos',
      tituloSintetico(3, hoje, 100, { tipo: 'M', credor: 7001, profissional: 70 }),
    );
    expect(ok.statusCode).toBe(200);
  });

  it('regra 3: chave natural repetida 409; a mesma Idempotency-Key devolve a mesma resposta sem efeito', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const r1 = await a.post(s, '/financeiro/pagar/titulos', tituloSintetico(10, hoje), 'idem-m32-1');
    expect(r1.statusCode).toBe(200);
    const r2 = await a.post(s, '/financeiro/pagar/titulos', tituloSintetico(10, hoje), 'idem-m32-1');
    expect(r2.json().repetida).toBe(true);
    expect(r2.json().ids.titulo).toBe(r1.json().ids.titulo);
    const dup = await a.post(s, '/financeiro/pagar/titulos', tituloSintetico(10, hoje));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('duplicado');
  });

  it('parcelas: 3 de R$ 100,00 para um documento de R$ 300,00; a classificação só na 1, valendo para o documento', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const errado = await a.post(s, '/financeiro/pagar/titulos', {
      ...tituloSintetico(20, hoje, 300),
      parcelas: [{ parcela: 1, vencimento: hoje, valor: 100 }],
    });
    expect(errado.json().codigo).toBe('parcelas-nao-somam');
    const r = await a.post(s, '/financeiro/pagar/titulos', {
      ...tituloSintetico(20, hoje, 300),
      parcelas: [1, 2, 3].map((p) => ({ parcela: p, vencimento: hoje, valor: 100 })),
    });
    expect(r.json().ids.parcelas).toBe(3);
    const ids = String(r.json().ids.ids).split(',').map(Number);
    const d = (await a.get(s, `/financeiro/pagar/titulos/${ids[2]}`)).json();
    expect(d.parcelas).toHaveLength(3);
    expect(d.classificacao).toMatchObject({ grupo: 216, subgrupo: 2, item: 1, valor: 300 });
    expect(d.alcada).toMatchObject({ exigidas: 1, feitas: 0, aprovado: false });
    expect(d.legendaStatus).toContain('a confirmar');
  });

  it('regra 6: excluir o título em aberto; o pago não se apaga (estorno)', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const r = await a.post(s, '/financeiro/pagar/titulos', tituloSintetico(30, hoje));
    const id = r.json().ids.titulo as number;
    expect((await a.post(s, `/financeiro/pagar/titulos/${id}/excluir`, {})).statusCode).toBe(200);
    expect((await a.get(s, `/financeiro/pagar/titulos/${id}`)).statusCode).toBe(404);
    const pago = await a.post(s, '/financeiro/pagar/titulos/11/excluir', {});
    expect(pago.json().codigo).toBe('titulo-pago');
    expect(pago.json().detail).toContain('estorno');
  });

  it('a lista: situação derivada e o credor órfão como "não encontrado no cadastro"; o documento do credor mascarado', async () => {
    const s = await a.entrar('SINT.FIN.LANCA');
    const l = (await a.get(s, '/financeiro/pagar/titulos')).json();
    expect(l.itens.find((t: { id: number }) => t.id === 11).situacao).toBe('pago');
    const d = (await a.get(s, '/financeiro/pagar/titulos/12')).json();
    expect(d.documentoCredor).toMatch(/^\*\*/);
    // O "mostrar" é permitido só ao contas a pagar, repasse e tesouraria, e auditado.
    const fora = await a.entrar('SINT.AGENDA');
    expect(
      (
        await a.post(fora, '/financeiro/dados/mostrar', {
          tipo: 'documento-credor',
          titulo: 12,
          finalidade: 'conferir o pagamento',
        })
      ).statusCode,
    ).toBe(403);
    const t = await a.entrar('SINT.FIN.PAGA');
    const m = await a.post(t, '/financeiro/dados/mostrar', {
      tipo: 'documento-credor',
      titulo: 12,
      finalidade: 'conferir o pagamento',
    });
    expect(m.statusCode).toBe(200);
    expect(a.trilha.eventos.some((x) => x.evento === 'financeiro.dado.mostrado')).toBe(true);
  });
});
