// GET /api/sistema/sonda (sondas da implantação azul/verde): segredo, hospital validado, as cinco sondas e a recusa
// de gravação de negócio pela liberação das chaves de operação.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Configuracao } from '../../configuracao.js';
import { VersaoService } from '../../versao.service.js';
import type { CatalogoOperacoesLiberacao } from '../config/catalogo-operacoes.js';
import type { FonteConfiguracao } from '../config/configuracao-fonte.js';
import { OPERACAO_SONDA_NEGOCIO, SondaImplantacaoController } from './sonda.controller.js';
import { PortaSondaMemoria, type PortaSonda, portaSondaIndisponivel } from './sonda.js';

const TOKEN = 't'.repeat(40);
const ENV_ORIGINAL = { ...process.env };

function montar(o: {
  porta?: PortaSonda;
  ambiente?: string;
  chaves?: { tipo: string; chave: string; escopo: string; valor: string; ligada: boolean | null }[];
}) {
  const fonte = { chaves: async () => o.chaves ?? [] } as unknown as FonteConfiguracao;
  const catalogo: CatalogoOperacoesLiberacao = {
    operacoes: () => [],
    estado: (nome) => (nome === OPERACAO_SONDA_NEGOCIO ? ({} as never) : null),
  };
  const cfg = { ambiente: o.ambiente ?? 'dev', produtoNome: 'p', rede: 'rede-teste' } as Configuracao;
  return new SondaImplantacaoController(
    o.porta ?? new PortaSondaMemoria(['H1', 'H2']),
    fonte,
    catalogo,
    cfg,
    new VersaoService(),
  );
}

describe('sonda da implantação', () => {
  beforeEach(() => {
    process.env['SONDA_TOKEN'] = TOKEN;
    delete process.env['SONDA_LOGIN'];
    delete process.env['SONDA_SENHA'];
    delete process.env['SONDA_VERSAO_ESPERADA'];
  });
  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  it('sem o segredo (ou com segredo curto): 404', async () => {
    await expect(montar({}).sonda(undefined)).rejects.toMatchObject({ status: 404 });
    await expect(montar({}).sonda('x')).rejects.toMatchObject({ status: 404 });
    process.env['SONDA_TOKEN'] = 'curto';
    await expect(montar({}).sonda('curto')).rejects.toMatchObject({ status: 404 });
  });

  it('hospital fora do cadastro do cliente: 400; sem hospital, o primeiro', async () => {
    await expect(montar({}).sonda(TOKEN, 'H9')).rejects.toMatchObject({ status: 400 });
    const r = await montar({}).sonda(TOKEN);
    expect(r.hospital).toBe('H1');
    expect(r.sondas.map((s) => s.sonda)).toEqual([
      'saude',
      'versao',
      'login-sonda',
      'painel-leitos',
      'recusa-negocio',
    ]);
    expect(r.sondas.find((s) => s.sonda === 'saude')?.ok).toBe(true);
    // Sem usuário de sonda nem painel: a implantação não fica pronta (falha fechada).
    expect(r.sondas.find((s) => s.sonda === 'login-sonda')?.ok).toBe(false);
    expect(r.pronta).toBe(false);
  });

  it('porta indisponível: nenhum estabelecimento vale (400, falha fechada)', async () => {
    await expect(montar({ porta: portaSondaIndisponivel }).sonda(TOKEN, 'H1')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('banco que não responde: saude falha', async () => {
    const porta: PortaSonda = { bancoResponde: async () => false, estabelecimentos: async () => ['H1'] };
    const r = await montar({ porta }).sonda(TOKEN);
    expect(r.sondas.find((s) => s.sonda === 'saude')).toMatchObject({
      ok: false,
      detalhe: 'banco não responde',
    });
  });

  it('recusa-negocio: em produção, a operação liberada ao usuário de sonda reprova; a desligada aprova', async () => {
    process.env['SONDA_LOGIN'] = 'sonda';
    const liberada = await montar({ ambiente: 'producao' }).sonda(TOKEN);
    expect(liberada.sondas.find((s) => s.sonda === 'recusa-negocio')?.ok).toBe(false);
    const desligada = await montar({
      ambiente: 'producao',
      chaves: [
        { tipo: 'operacao', chave: OPERACAO_SONDA_NEGOCIO, escopo: 'pessoa', valor: 'sonda', ligada: false },
      ],
    }).sonda(TOKEN);
    expect(desligada.sondas.find((s) => s.sonda === 'recusa-negocio')).toMatchObject({
      ok: true,
      detalhe: 'gravação de negócio recusada',
    });
  });

  it('versao: a esperada diferente da no ar reprova', async () => {
    process.env['SONDA_VERSAO_ESPERADA'] = 'outra';
    const r = await montar({}).sonda(TOKEN);
    expect(r.sondas.find((s) => s.sonda === 'versao')?.ok).toBe(false);
  });
});
