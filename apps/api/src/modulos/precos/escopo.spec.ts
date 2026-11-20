// M12, correção da verificação: o escopo de convênio da sessão (TBUSERS_TBCONVEN, lido pelo M06) vale em
// TODAS as leituras de convênio, também nas listas sem convênio pedido (credenciamento, de-para, códigos de
// prestador, tabelas) e nas consultas por convênio (valor vigente, aceita-atendimento): fora do escopo, o 404
// do inexistente ou a lista vazia. E o cache da lista de convênios no armazém compartilhado (Valkey), com a
// invalidação depois do commit. Controladores chamados direto, sobre a fonte EM MEMÓRIA (dados sintéticos).
import { ESCOPOS_SEM_RESTRICAO } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso } from '@sgh/dominio-acesso';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { CacheConfig } from '../config/public-api.js';
import { ConveniosController } from './convenios.controller.js';
import { FontePrecosMemoria } from './fonte-memoria.js';
import type { FontePrecos } from './fonte.js';
import { MotorController } from './motor.controller.js';
import { PrecosController } from './precos.controller.js';
import { ServicoPrecos } from './servico.js';

const catalogo = fonteCatalogoArquivo(resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'));

const PERMISSOES = [
  'convenio.operadora.ler',
  'convenio.contrato.ler',
  'convenio.credenciamento.ler',
  'convenio.codigoPrestador.ler',
  'cadastro.credenciamento.verBancario',
  'preco.dePara.ler',
  'preco.porte.ler',
  'preco.tabela.ler',
];

function req(convenios: string[]): RequisicaoAutorizada {
  const escopos = { ...ESCOPOS_SEM_RESTRICAO, convenios };
  return {
    headers: {},
    sgh: {
      sessao: {
        estabelecimentoAtivo: 'aa',
        rede: 'rede-teste',
        usuario: { id: '1', login: 'SINT.FATURAMENTO' },
        escopos,
        permissoes: PERMISSOES,
      },
      ability: criarAbility(regrasDeAcesso(PERMISSOES, escopos)),
      real: true,
    },
  } as unknown as RequisicaoAutorizada;
}

function montar(fonte: FontePrecos = new FontePrecosMemoria(catalogo, 'dev')) {
  const servico = new ServicoPrecos(fonte);
  const trilha = new RegistradorTrilhaMemoria();
  const resolvedor = {} as ResolvedorSessao;
  return {
    motor: new MotorController(fonte),
    convenios: new ConveniosController(servico, fonte, trilha, null, resolvedor),
    precos: new PrecosController(servico, fonte, trilha, null, resolvedor),
  };
}

const convs = (p: { itens: readonly Record<string, unknown>[] }) =>
  new Set(p.itens.map((i) => i['convenio']));

describe('escopo de convênio da sessão (TBUSERS_TBCONVEN) nas leituras do M12', () => {
  const so305 = req(['305']);
  const livre = req([]);

  it('credenciamento, atos e de-para sem convênio pedido: só os do escopo (nunca "todos")', async () => {
    const { motor } = montar();
    expect(convs(await motor.credenciamento({}, livre))).toEqual(new Set([305, 10]));
    expect(convs(await motor.credenciamento({}, so305))).toEqual(new Set([305]));
    expect((await motor.credenciamento({ convenio: '10' }, so305)).itens).toEqual([]);
    const comp = await motor.complementar({}, so305);
    expect(convs(comp.atos)).toEqual(new Set([305]));
    expect(convs(await motor.dePara({}, livre))).toEqual(new Set([305, 306]));
    expect(convs(await motor.dePara({}, so305))).toEqual(new Set([305]));
    expect((await motor.portes({ convenio: '306' }, so305)).itens).toEqual([]);
  });

  it('códigos de prestador: só os do escopo; convênio fora do escopo, lista vazia', async () => {
    const { convenios } = montar();
    expect(convs(await convenios.codigos({}, livre))).toEqual(new Set([305, 306]));
    expect(convs(await convenios.codigos({}, so305))).toEqual(new Set([305]));
    expect((await convenios.codigos({ convenio: '306' }, so305)).itens).toEqual([]);
  });

  it('valor vigente e aceita-atendimento: fora do escopo, o 404 do inexistente', async () => {
    const { convenios, precos } = montar();
    await expect(
      precos.consulta({ convenio: '306', tipo: 'honorario', item: '306001' }, so305),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await precos.consulta({ convenio: '305', tipo: 'honorario', item: '305001' }, so305)).tabela,
    ).toBe(305);
    await expect(convenios.aceita('306', so305)).rejects.toMatchObject({ status: 404 });
    expect((await convenios.aceita('305', so305)).aceita).toBe(true);
  });

  it('tabelas: os convênios que usam cada tabela saem filtrados pelo escopo (o cache é do estabelecimento)', async () => {
    const { precos } = montar();
    const todas = (await precos.tabelas('honorarios', livre)).tabelas;
    expect(
      todas
        .find((t) => t.codigo === 10)
        ?.convenios.map((c) => c.codigo)
        .sort(),
    ).toEqual([1, 10]);
    const filtradas = (await precos.tabelas('honorarios', so305)).tabelas;
    expect(filtradas.find((t) => t.codigo === 10)?.convenios).toEqual([]);
    expect(filtradas.find((t) => t.codigo === 305)?.convenios.map((c) => c.codigo)).toEqual([305]);
    // A tabela continua compartilhada (fato da tabela), sem revelar quais convênios fora do escopo a usam.
    expect(filtradas.find((t) => t.codigo === 10)?.compartilhada).toBe(true);
  });
});

describe('lista de convênios no armazém compartilhado (Valkey)', () => {
  it('a busca lê uma vez e serve do cache; a invalidação depois do commit relê', async () => {
    const memoria = new FontePrecosMemoria(catalogo, 'dev');
    let leituras = 0;
    const fonte = new Proxy(memoria, {
      get(alvo, p, r) {
        if (p === 'destino') return 'legado';
        if (p === 'convenios')
          return () => {
            leituras++;
            return alvo.convenios();
          };
        return Reflect.get(alvo, p, r) as unknown;
      },
    }) as unknown as FontePrecos;
    const cache = new CacheConfig(new ArmazemMemoria());
    const servico = new ServicoPrecos(fonte, cache);
    const c = { rede: 'rede-teste', hospital: 'aa', traceId: 't' };
    await servico.listarConvenios(c, { busca: 'alfa', situacao: 'todos' }, null);
    await servico.listarConvenios(c, { busca: 'beta', situacao: 'ativos' }, null);
    expect(leituras).toBe(1);
    await servico.invalidarConvenios(c, Date.now());
    await servico.listarConvenios(c, { busca: '', situacao: 'todos' }, null);
    expect(leituras).toBe(2);
    // Sem o cache (ou com a fonte em memória), a leitura é direta.
    const direto = new ServicoPrecos(memoria, cache);
    await direto.listarConvenios(c, { busca: '', situacao: 'todos' }, null);
    expect(leituras).toBe(2);
  });
});
