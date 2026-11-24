// Descrição cirúrgica (04-CC linha 96; F3.4, fatia F3.4-4): assinar e incluir adendo pedem a senha de novo
// (reautenticação com CSRF). Sem senha ou com a senha errada, a operação nem é chamada; com a senha certa, a operação
// recebe o corpo sem a senha. Salvar o rascunho não pede senha.
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { DescricaoCirurgicaController } from './descricao-cirurgica.controller.js';
import type { PortaDescricaoCirurgica } from './descricao-cirurgica-porta.js';

const SENHA_CERTA = 'senha-de-teste';

function montar(comResolvedor = true) {
  const executar = vi.fn(async () => ({ resultado: { descricao: 7 }, repetida: false }));
  const porta = {
    destino: 'banco',
    tela: vi.fn(),
    doPaciente: vi.fn(),
    executar,
  } as unknown as PortaDescricaoCirurgica;
  const reautenticar = vi.fn(async (_id: string, _rede: string | null, senha: string) => {
    if (senha !== SENHA_CERTA) throw new Error('senha não confere');
  });
  const sessoes = {
    csrfConfere: vi.fn(async () => true),
    reautenticar,
  } as unknown as ServicoSessao;
  const resolvedor = {
    idSessao: () => 'sessao-1',
    rede: () => '127.0.0.1',
  } as unknown as ResolvedorSessao;
  const c = new DescricaoCirurgicaController(porta, sessoes, comResolvedor ? resolvedor : null);
  const req = {
    headers: { cookie: 'sgh_csrf=tk', 'x-csrf': 'tk', 'idempotency-key': 'chave-teste-descricao-0001' },
    sgh: {
      real: true,
      sessao: { estabelecimentoAtivo: 'aa', rede: '', usuario: { id: '1', login: 'teste' } },
      ability: { can: () => true },
    },
  } as unknown as RequisicaoAutorizada;
  return { c, req, executar, reautenticar };
}

const tipo = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ErroProblema ? e.tipo : String(e)),
  );

describe('descrição cirúrgica: senha no gesto de assinar e no adendo', () => {
  it('assinar sem senha: recusa e nada é gravado', async () => {
    const { c, req, executar } = montar();
    expect(await tipo(c.salvar('5', { versao: 1, assinar: true }, req))).toBe('reautenticacao-necessaria');
    expect(executar).not.toHaveBeenCalled();
  });

  it('assinar com a senha errada: recusa e nada é gravado', async () => {
    const { c, req, executar, reautenticar } = montar();
    expect(await tipo(c.salvar('5', { versao: 1, assinar: true, senha: 'errada' }, req))).toBe(
      'reautenticacao-necessaria',
    );
    expect(reautenticar).toHaveBeenCalledTimes(1);
    expect(executar).not.toHaveBeenCalled();
  });

  it('adendo sem senha ou com a senha errada: recusa e nada é gravado', async () => {
    const { c, req, executar } = montar();
    expect(await tipo(c.adendo('9', { texto: 'Complemento', motivo: 'Omissão' }, req))).toBe(
      'reautenticacao-necessaria',
    );
    expect(await tipo(c.adendo('9', { texto: 'Complemento', motivo: 'Omissão', senha: 'errada' }, req))).toBe(
      'reautenticacao-necessaria',
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('sem resolvedor de sessão: falha fechada', async () => {
    const { c, req, executar } = montar(false);
    expect(await tipo(c.salvar('5', { versao: 1, assinar: true, senha: SENHA_CERTA }, req))).toBe(
      'reautenticacao-necessaria',
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('com a senha certa: a operação recebe o corpo sem a senha; o rascunho não pede senha', async () => {
    const { c, req, executar, reautenticar } = montar();
    const r = await c.salvar('5', { versao: 1, assinar: true, senha: SENHA_CERTA }, req);
    expect(r.mensagem).toBe('Descrição assinada.');
    const entrada = (executar.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(entrada).toEqual({ versao: 1, assinar: true, ato: 5 });
    await c.salvar('5', { versao: null }, req);
    expect(reautenticar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledTimes(2);
  });
});
