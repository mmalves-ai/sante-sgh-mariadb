// W0-03 (programa CRUD completo) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA: a passagem de
// plantão cancelada por quem passou, com o motivo, antes do aceite (409 depois do aceite; 409 para outro login); o
// aparelho da beira do leito alterado (nome e unidade) e excluído só sem leituras vinculadas (409 com a contagem).
// Dados sintéticos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppEnfermagem, criarAppEnfermagem } from './enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

async function passar(data: string) {
  const s = await a.entrar('SINT.ENF.PLANTAO');
  const r = await a.post(s, '/enfermagem/plantao', {
    unidade: 'UTI',
    turno: 'noturno',
    data,
    recebedor: 'SINT.ENF.APOIO',
    notas: [{ atendimento: 25101, paciente: 25001, situacao: 'estável', pendencias: [] }],
  });
  expect(r.statusCode).toBe(201);
  return { s, id: r.json().passagem as number };
}

describe('W0-03: cancelar a passagem de plantão', () => {
  it('quem passou cancela antes do aceite, com o motivo; a passagem continua legível como cancelada', async () => {
    const { s, id } = await passar('2026-10-20');
    const curto = await a.post(s, `/enfermagem/plantao/${id}/cancelar`, { motivo: 'erro' });
    expect(curto.statusCode).toBe(400);
    const outro = await a.entrar('SINT.ENF.APOIO');
    const deOutro = await a.post(outro, `/enfermagem/plantao/${id}/cancelar`, {
      motivo: 'passagem feita para o turno errado',
    });
    expect(deOutro.statusCode).toBe(409);
    expect(deOutro.json().codigo).toBe('plantao-de-outro');
    const ok = await a.post(s, `/enfermagem/plantao/${id}/cancelar`, {
      motivo: 'passagem feita para o turno errado',
    });
    expect(ok.statusCode).toBe(200);
    const lido = (await a.get(s, '/enfermagem/plantao?unidade=UTI')).json();
    const p = lido.passagens.find((x: { id: number }) => x.id === id);
    expect(p.situacao).toBe('cancelada');
    expect(p.cancelamento).toMatchObject({
      motivo: 'passagem feita para o turno errado',
      por: 'SINT.ENF.PLANTAO',
    });
    expect(p.notas).toHaveLength(1);
    // A cancelada não se aceita.
    expect((await a.post(outro, `/enfermagem/plantao/${id}/aceite`, { aceite: true })).statusCode).toBe(409);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.plantao.cancelado')).toBe(true);
    // A trilha não leva o texto clínico nem o motivo.
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/estável/);
  });

  it('depois do aceite, o cancelamento é recusado com 409', async () => {
    const { s, id } = await passar('2026-10-21');
    const apoio = await a.entrar('SINT.ENF.APOIO');
    expect((await a.post(apoio, `/enfermagem/plantao/${id}/aceite`, { aceite: true })).statusCode).toBe(200);
    const r = await a.post(s, `/enfermagem/plantao/${id}/cancelar`, {
      motivo: 'passagem feita para o turno errado',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('plantao-ja-respondido');
    expect(
      (await a.post(s, '/enfermagem/plantao/999999/cancelar', { motivo: 'passagem inexistente aqui' }))
        .statusCode,
    ).toBe(404);
  });
});

describe('W0-03: aparelho da beira do leito (alterar e excluir sem órfão)', () => {
  it('altera o nome e a unidade; a lista mostra o novo nome', async () => {
    const sup = await a.entrar('SINT.SUPERVISOR.ENF');
    const d = (
      await a.post(sup, '/enfermagem/dispositivos', { nome: 'Tablet errado', unidade: 'UTI', tipo: 'tablet' })
    ).json();
    // O nome e a unidade mudam só com o motivo (fica no cadastro do aparelho, com quem e quando).
    expect(
      (
        await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, {
          nome: 'Tablet leito 4',
          unidade: 'cm',
        })
      ).statusCode,
    ).toBe(400);
    const r = await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, {
      nome: 'Tablet leito 4',
      unidade: 'cm',
      motivo: 'nome e unidade cadastrados errado',
    });
    expect(r.statusCode).toBe(200);
    const lista = (await a.get(sup, '/enfermagem/dispositivos')).json() as {
      id: number;
      nome: string;
      unidade: string;
    }[];
    expect(lista.find((x) => x.id === d.dispositivo)).toMatchObject({
      nome: 'Tablet leito 4',
      unidade: 'CM',
    });
    expect((await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, {})).statusCode).toBe(400);
    // Revisão W0-03: retirar (inativar) também exige o motivo; cada alteração guarda o valor anterior.
    expect(
      (await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, { ativo: false })).statusCode,
    ).toBe(400);
    expect(
      (
        await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, {
          ativo: false,
          motivo: 'aparelho com a tela quebrada',
        })
      ).statusCode,
    ).toBe(200);
    const comVersoes = (await a.get(sup, '/enfermagem/dispositivos')).json() as {
      id: number;
      versoes: { versao: number; nome: string; unidade: string; ativo: boolean; motivo: string }[];
    }[];
    expect(comVersoes.find((x) => x.id === d.dispositivo)!.versoes).toEqual([
      expect.objectContaining({
        versao: 1,
        nome: 'Tablet errado',
        unidade: 'UTI',
        ativo: true,
        motivo: 'nome e unidade cadastrados errado',
      }),
      expect.objectContaining({
        versao: 2,
        nome: 'Tablet leito 4',
        unidade: 'CM',
        ativo: true,
        motivo: 'aparelho com a tela quebrada',
      }),
    ]);
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (await a.post(tec, `/enfermagem/dispositivos/${d.dispositivo}`, { nome: 'Tablet do técnico' }))
        .statusCode,
    ).toBe(403);
  });

  it('com leituras vinculadas, a exclusão devolve 409 com a contagem; sem vínculo, exclui', async () => {
    const sup = await a.entrar('SINT.SUPERVISOR.ENF');
    const lista = (await a.get(sup, '/enfermagem/dispositivos')).json() as { id: number; nome: string }[];
    const posto = lista.find((x) => x.nome === 'Tablet do posto da UTI')!;
    const recusa = await a.post(sup, `/enfermagem/dispositivos/${posto.id}/excluir`, {
      motivo: 'aparelho cadastrado em duplicidade',
    });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe('dispositivo-com-leituras');
    expect(recusa.json().detail).toMatch(/3 leitura\(s\) vinculada\(s\) \(3 checagens feitas no aparelho\)/);
    // Continua na lista; a saída é retirar (inativar).
    expect(
      (await a.get(sup, '/enfermagem/dispositivos')).json().some((x: { id: number }) => x.id === posto.id),
    ).toBe(true);
    const novo = (
      await a.post(sup, '/enfermagem/dispositivos', {
        nome: 'Tablet por engano',
        unidade: 'UTI',
        tipo: 'coletor',
      })
    ).json();
    const ok = await a.post(sup, `/enfermagem/dispositivos/${novo.dispositivo}/excluir`, {
      motivo: 'aparelho cadastrado por engano',
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (await a.get(sup, '/enfermagem/dispositivos'))
        .json()
        .some((x: { id: number }) => x.id === novo.dispositivo),
    ).toBe(false);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.dispositivo.excluido')).toBe(true);
  });
});
