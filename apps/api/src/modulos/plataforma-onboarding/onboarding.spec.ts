// Painel de onboarding (F4 L3), unidade: só o ator da plataforma passa; recusas viram Problem Details; a entrada é
// validada pelos contratos; a execução sai com lista branca (sem nome de tabela da origem nem valores).
import type { ClienteOnboarding, ExecucaoConector } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { execucaoDaLinha } from './execucao.js';
import { administradorDaSessao, OnboardingController } from './onboarding.controller.js';
import { ErroOnboarding, type PonteConector, type RepositorioOnboarding } from './porta.js';
import { ServicoOnboarding } from './servico.js';

const req = (usuario: Record<string, unknown> | null) =>
  ({ sgh: usuario ? { sessao: { usuario } } : undefined }) as unknown as RequisicaoAutorizada;
const PLAT = req({ id: 'plataforma:7', login: 'plataforma:adm', ator: 'plataforma' });

function montar() {
  const chamadas: string[] = [];
  const repo: RepositorioOnboarding = {
    listarClientes: async () => [] as ClienteOnboarding[],
    historico: async (c) =>
      c === 'exemplo' ? [execucaoDaLinha({ id: 1, tipo: 'sincronizar', estado: 'concluida' })] : [],
    execucao: async (_c, id) =>
      id === 1 ? execucaoDaLinha({ id: 1, tipo: 'importar', estado: 'fila' }) : null,
    enfileirar: async (c, t, a, confirmar) => {
      chamadas.push(`enfileirar ${c} ${t} ${a}${confirmar ? ' confirmada' : ''}`);
      if (c === 'ocupado') throw new ErroOnboarding('conflito', 'Já há uma execução.');
      return 9;
    },
  };
  const ponte: PonteConector = {
    criarCliente: async (c, n, cnpj, a) => {
      chamadas.push(`criar ${c} ${n} ${cnpj} ${a}`);
      return { codigo: c, banco: `cliente_${c}`, tabelas: 1 };
    },
    listarOrigens: async () => [{ arquivo: 'a.fdb', tamanhoBytes: 8192, aceito: true, motivo: null }],
    vincular: async (c, arq, a) => {
      chamadas.push(`vincular ${c} ${arq} ${a}`);
      return { arquivo: arq, tamanhoBytes: 8192, sha256: 'f'.repeat(64) };
    },
  };
  return { c: new OnboardingController(new ServicoOnboarding(repo, ponte)), chamadas };
}

async function problema(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema) return e.getStatus();
    throw e;
  }
  return 200;
}

describe('painel de onboarding: portão do administrador da plataforma', () => {
  it('lê o id do administrador só da sessão do ator da plataforma', () => {
    expect(administradorDaSessao(PLAT)).toBe(7);
    expect(administradorDaSessao(req({ id: '15', login: 'ana' }))).toBe(null);
    expect(administradorDaSessao(req(null))).toBe(null);
  });

  it('usuário do cliente (mesmo com a permissão) recebe 403 em todas as rotas', async () => {
    const { c, chamadas } = montar();
    const usuario = req({ id: '15', login: 'ana' });
    expect(await problema(c.listar(usuario))).toBe(403);
    expect(await problema(c.criar(usuario, { codigo: 'novo', nome: 'X' }))).toBe(403);
    expect(await problema(c.origens(usuario))).toBe(403);
    expect(await problema(c.vincular(usuario, 'novo', { arquivo: 'a.fdb' }))).toBe(403);
    expect(await problema(c.pedir(usuario, 'novo', { tipo: 'importar' }))).toBe(403);
    expect(await problema(c.execucao(usuario, 'novo', '1'))).toBe(403);
    expect(chamadas).toEqual([]);
  });

  it('sem o serviço (sem núcleo), 503', async () => {
    expect(await problema(new OnboardingController(null).listar(PLAT))).toBe(503);
  });

  it('o administrador cria, vincula e pede; o id dele segue para o evento', async () => {
    const { c, chamadas } = montar();
    expect(await c.criar(PLAT, { codigo: 'exemplo', nome: ' Cliente de exemplo ' })).toEqual({
      codigo: 'exemplo',
      banco: 'cliente_exemplo',
      tabelas: 1,
    });
    expect((await c.origens(PLAT)).origens[0]?.aceito).toBe(true);
    await c.vincular(PLAT, 'exemplo', { arquivo: 'sub/a.fdb' });
    expect(await c.pedir(PLAT, 'exemplo', { tipo: 'importar' })).toEqual({ execucao: 9 });
    expect(chamadas).toEqual([
      'criar exemplo Cliente de exemplo null 7',
      'vincular exemplo sub/a.fdb 7',
      'enfileirar exemplo importar 7',
    ]);
  });

  it('entrada inválida 400, execução ativa 409, execução de outro cliente 404', async () => {
    const { c, chamadas } = montar();
    expect(await problema(c.criar(PLAT, { codigo: 'Maiúscula', nome: 'X' }))).toBe(400);
    expect(await problema(c.criar(PLAT, { codigo: 'ok', nome: 'X', extra: 1 }))).toBe(400);
    for (const arquivo of ['/abs/a.fdb', '../a.fdb', 'a/../../b.fdb', 'a.txt'])
      expect(await problema(c.vincular(PLAT, 'ok', { arquivo }))).toBe(400);
    expect(await problema(c.pedir(PLAT, 'ok', { tipo: 'apagar' }))).toBe(400);
    expect(await problema(c.pedir(PLAT, 'ocupado', { tipo: 'sincronizar' }))).toBe(409);
    // a confirmação da exclusão em massa só vale para o Sincronizar e chega ao repositório (quem confirmou: o admin)
    expect(await problema(c.pedir(PLAT, 'ok', { tipo: 'importar', confirmarExclusaoEmMassa: true }))).toBe(
      400,
    );
    expect(
      await problema(c.pedir(PLAT, 'ok', { tipo: 'sincronizar', confirmarExclusaoEmMassa: 'sim' })),
    ).toBe(400);
    expect(await c.pedir(PLAT, 'ok', { tipo: 'sincronizar', confirmarExclusaoEmMassa: true })).toEqual({
      execucao: 9,
    });
    expect(await problema(c.execucao(PLAT, 'ok', '2'))).toBe(404);
    expect(await problema(c.execucao(PLAT, 'ok', 'x'))).toBe(400);
    expect(chamadas).toEqual(['enfileirar ocupado sincronizar 7', 'enfileirar ok sincronizar 7 confirmada']);
  });
});

describe('execução: lista branca dos contadores do motor', () => {
  it('só entidade de destino, contagens e pendências por gravidade', () => {
    const e: ExecucaoConector = execucaoDaLinha({
      id: 3,
      tipo: 'importar',
      estado: 'concluida',
      etapa: 'concluída',
      percentual: '100.00',
      motivo_falha: null,
      solicitado_em: new Date('2026-11-21T10:00:00Z'),
      contadores: JSON.stringify({
        registros_lidos: 4838,
        arquivo_inalterado: true,
        abertura: { cow_bytes: 1 },
        entidades: {
          paciente: {
            tabela_origem: 'TABELA_DA_ORIGEM',
            registros_origem: 320,
            registros_destino: 318,
            recusados: 2,
            conferido: true,
            soma_destino: 'a'.repeat(64),
          },
        },
        pendencias: {
          total: 3,
          criticas: 2,
          por_regra: { 'paciente:prontuario_duplicado:critica': 2, 'x:y:z': 1 },
        },
      }),
    });
    expect(e.entidades).toEqual([
      { entidade: 'paciente', registrosOrigem: 320, registrosDestino: 318, recusados: 2, conferido: true },
    ]);
    expect(JSON.stringify(e)).not.toContain('TABELA_DA_ORIGEM');
    expect(e.pendencias).toEqual({
      total: 3,
      criticas: 2,
      porRegra: [
        { entidade: 'paciente', regra: 'prontuario_duplicado', gravidade: 'critica', quantidade: 2 },
      ],
    });
    expect([e.percentual, e.registrosLidos, e.arquivoInalterado, e.solicitadoEm]).toEqual([
      100,
      4838,
      true,
      '2026-11-21T10:00:00.000Z',
    ]);
  });
});
