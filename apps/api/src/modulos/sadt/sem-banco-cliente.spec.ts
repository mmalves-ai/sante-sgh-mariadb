// 05-SADT linha 7 (C1-042): o 503 de "precisa do banco do cliente" sai com o código próprio no Problem Details, e o
// 503 de outra causa (o gerador de PDF fora do ar) não o leva. A tela só mostra o aviso de banco por esse código.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { LoteTrabalhoController } from './lote-trabalho.controller.js';
import { CODIGO_SEM_BANCO_CLIENTE, semBancoDoCliente } from './sem-banco-cliente.js';

const comSessao = () =>
  ({
    headers: {},
    sgh: {
      sessao: { estabelecimentoAtivo: 'hsint', rede: 'rede-sint', usuario: { id: '7', login: 'SINT' } },
    },
  }) as unknown as RequisicaoAutorizada;

describe('sem banco do cliente', () => {
  it('o erro é 503 "indisponivel" com o código próprio e o título dado', () => {
    const e = semBancoDoCliente('O pedido de exames precisa do banco do cliente.');
    expect(e).toBeInstanceOf(ErroProblema);
    expect(e.getStatus()).toBe(503);
    expect(e.tipo).toBe('indisponivel');
    expect(e.titulo).toBe('O pedido de exames precisa do banco do cliente.');
    expect(e.extras.codigo).toBe(CODIGO_SEM_BANCO_CLIENTE);
    expect(CODIGO_SEM_BANCO_CLIENTE).toBe('sem-banco-cliente');
  });

  it('o controller do diagnóstico sem o banco do cliente recusa com o código próprio', async () => {
    const semBanco = new LoteTrabalhoController(null);
    const erro = await Promise.resolve()
      .then(() => semBanco.listar({}, comSessao()))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(erro).toBeInstanceOf(ErroProblema);
    expect((erro as ErroProblema).getStatus()).toBe(503);
    expect((erro as ErroProblema).extras.codigo).toBe(CODIGO_SEM_BANCO_CLIENTE);
  });

  it('o 503 de outra causa (emissão sem configuração) não leva o código de banco', () => {
    const outro = new ErroProblema(
      'indisponivel',
      503,
      'Emissão indisponível',
      'O serviço não está configurado.',
    );
    expect(outro.extras.codigo).toBeUndefined();
  });
});
