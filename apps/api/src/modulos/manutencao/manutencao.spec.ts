// Manutenção e engenharia clínica pela HTTP (M55, etapa 1; ficha, seções 4, 7 e 8; regras 1 a 3): a sessão real sobre a
// fonte sintética e a manutenção EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS: setores 101 a 105 e 199 inativo,
// equipamentos 9001 a 9004, a cobertura 9101 e os planos 9201 e 9202), com o relógio controlado pelo teste; a chave
// `manutencao` desligada pelo administrador num app à parte.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import type { PortaPatrimonio } from '../patrimonio/public-api.js';
import { deQuery } from './manutencao.controller.js';
import { PortaManutencaoMemoria } from './porta-memoria.js';

const R = '/api/manutencao';
/** O patrimônio SINTÉTICO só com o que a manutenção lê: um bem em uso e um baixado. */
const BENS = [
  {
    id: 7001,
    plaqueta: 'PAT-000001',
    descricao: 'DESFIBRILADOR SINTETICO',
    situacao: 'ativo',
    dataAquisicao: '2016-10-28',
    vidaUtilMeses: 120,
    valorCent: 1_000_000,
  },
  { id: 7002, plaqueta: 'PAT-000002', descricao: 'DESFIBRILADOR BAIXADO', situacao: 'baixado' },
];
const patrimonioFalso = {
  destino: 'memoria',
  bem: async (_c: unknown, id: number) => BENS.find((b) => b.id === id) ?? null,
  bens: async (_c: unknown, f: { busca?: string }) => {
    const bens = BENS.filter(
      (b) => b.plaqueta.startsWith(f.busca ?? '') || b.descricao.includes(f.busca ?? ''),
    );
    return { bens, total: bens.length };
  },
} as unknown as PortaPatrimonio;
const HOJE = '2026-10-28';
interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semManutencao?: boolean; parametros?: Record<string, string> } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  const trilha = new RegistradorTrilhaMemoria();
  const relogio = { hoje: HOJE, agora: `${HOJE}T09:00` };
  const manutencao = new PortaManutencaoMemoria(() => ({ ...relogio }));
  const extras = Object.entries(o.parametros ?? {});
  const configuracao = extras.length
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: chavesIniciaisSinteticas,
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: (h: string) => [
          ...parametrosIniciaisSinteticos(h),
          ...extras.map(([chave, valor], i) => ({
            id: `teste-${i + 1}`,
            chave,
            nivel: 'estabelecimento' as const,
            alvo: h,
            valor,
            vigenteDesde: '2026-01-01T00:00:00.000Z',
            vigenteAte: null,
            justificativa: 'Teste sintético',
            autor: 'SINT.ADMIN',
          })),
        ],
      })
    : o.semManutencao
      ? fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'manutencao'),
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    manutencao,
    patrimonio: patrimonioFalso,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    trilha,
    relogio,
    manutencao,
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `${R}${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `${R}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload,
      }),
    put: (s: Sessao, url: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: `${R}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload,
      }),
    del: (s: Sessao, url: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'DELETE',
        url: `${R}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload,
      }),
    fechar: () => app.close(),
  };
}
type App = Awaited<ReturnType<typeof montar>>;

let a: App;
let chefe: Sessao;
let tecnico: Sessao;
let setor: Sessao;

beforeAll(async () => {
  a = await montar();
  [chefe, tecnico, setor] = await Promise.all([
    a.entrar('SINT.MANUTENCAO'),
    a.entrar('SINT.MANUTENCAO.TECNICO'),
    a.entrar('SINT.MANUTENCAO.SETOR'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

const abrir = (s: Sessao, x: Record<string, unknown>) =>
  a.post(s, '/os', {
    natureza: 'corretiva',
    centroCusto: 102,
    descricao: 'Não liga depois da queda de energia',
    ...x,
  });

describe('deQuery', () => {
  it('converte números, booleanos e listas e ignora o vazio', () => {
    expect(
      deQuery(
        { limite: '20', minhas: 'true', situacoes: 'aberta,concluida', vazio: '', termo: 'x' },
        { numeros: ['limite'], booleanos: ['minhas'], listas: ['situacoes'] },
      ),
    ).toEqual({ limite: 20, minhas: true, situacoes: ['aberta', 'concluida'], termo: 'x' });
  });
});

describe('manutenção: apoio e permissões', () => {
  it('o apoio diz o que cada um pode; quem só abre não lê equipamentos', async () => {
    const c = (await a.get(chefe, '/apoio')).json();
    expect(c.pode).toEqual({
      abrir: true,
      atender: true,
      encerrar: true,
      ler: true,
      editar: true,
      planejar: true,
    });
    expect(c.sla.emergencia).toEqual({ atendimentoHoras: 1, solucaoHoras: 4 });
    expect(c.aceiteHoras).toBe(72);
    expect(c.gravacao.ligada).toBe(true);
    const t = (await a.get(tecnico, '/apoio')).json();
    expect(t.pode).toMatchObject({ atender: true, encerrar: false, ler: true, editar: false });
    const s = (await a.get(setor, '/apoio')).json();
    expect(s.pode).toMatchObject({ abrir: true, atender: false, ler: false });
    expect(s.meusSetores).toEqual([102]);
    expect((await a.get(setor, '/equipamentos')).statusCode).toBe(403);
    expect((await a.get(setor, '/equipamentos/codigo/eq-cc-001')).json()).toMatchObject({
      id: 9001,
      criticidade: 'critica',
      parado: false,
    });
    expect((await a.get(setor, '/equipamentos/busca?termo=monitor')).json()).toHaveLength(1);
    expect((await a.get(setor, '/equipamentos/codigo/NAO-EXISTE')).statusCode).toBe(404);
  });
});

describe('ordem de serviço: o ciclo (regra 1)', () => {
  it('o setor abre pelo QR com o crítico parado; o setor é avisado; outro setor é recusado', async () => {
    const fora = await abrir(setor, { centroCusto: 101, codigoEquipamento: 'EQ-CAR-001' });
    expect(fora.statusCode).toBe(409);
    expect(fora.json().codigo).toBe('setor-nao-permitido');
    const r = await abrir(setor, {
      codigoEquipamento: 'eq-cc-001',
      equipamentoParado: true,
      prioridadeSugerida: 'emergencia',
    });
    expect(r.statusCode).toBe(201);
    const x = r.json();
    expect(x.numero).toMatch(/^2026-\d{6}$/);
    expect(x.alerta).toMatchObject({
      setor: { codigo: '102' },
      recurso: { tipo: 'salaCirurgica', id: 3, nome: 'Sala 3 (sintética)' },
      operacaoBloqueio: null,
      avisados: 2,
    });
    expect(a.manutencao.avisos({ rede: 'sintetica', hospital: 'aa' }).map((v) => v.login)).toEqual([
      'SINT.MANUTENCAO.SETOR',
      'SINT.PATRIMONIO.SETOR',
    ]);
    expect(a.trilha.eventos.some((e) => e.evento === 'manutencao.os.aberta')).toBe(true);
    const dup = await abrir(setor, { equipamento: 9001 });
    expect(dup.json().possiveisDuplicadas).toEqual([x.id]);
    const eq = (await a.get(chefe, '/equipamentos/9001')).json();
    expect(eq).toMatchObject({ parado: true, osAbertas: 2 });
  });

  it('assumir, concluir com a volta ao uso, o aceite de quem abriu; versão velha e permissão recusadas', async () => {
    a.relogio.agora = `${HOJE}T09:00`;
    const { id } = (await abrir(setor, { equipamento: 9001, equipamentoParado: true })).json();
    const lista = (await a.get(setor, '/os?situacoes=aberta&limite=50')).json();
    expect(lista.itens.map((o: { id: number }) => o.id)).toContain(id);
    const d0 = (await a.get(setor, `/os/${id}`)).json();
    expect(d0.acoes).toEqual(['cancelar']);
    expect(d0.atendimento).toMatchObject({ situacao: 'noPrazo' });
    expect(d0.alerta).toMatchObject({ setor: { codigo: '102' } });
    expect((await a.post(setor, `/os/${id}/assumir`, { versao: 1, prioridade: 'alta' })).statusCode).toBe(
      403,
    );
    a.relogio.agora = `${HOJE}T09:30`;
    const ass = await a.post(tecnico, `/os/${id}/assumir`, { versao: 1, prioridade: 'alta' });
    expect(ass.statusCode).toBe(200);
    expect(ass.json()).toMatchObject({ versao: 2, mensagem: 'Ordem de serviço em atendimento.' });
    const velha = await a.post(tecnico, `/os/${id}/andamento`, {
      versao: 1,
      situacao: 'aguardandoPeca',
      nota: 'Pedido da fonte',
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('desatualizado');
    expect(
      (
        await a.post(tecnico, `/os/${id}/andamento`, {
          versao: 2,
          situacao: 'aguardandoPeca',
          nota: 'Pedido da fonte',
        })
      ).statusCode,
    ).toBe(200);
    const concluir = {
      versao: 3,
      causa: 'energia',
      solucao: 'Troca da fonte de alimentação',
      inicioReparo: `${HOJE}T09:40`,
      fimReparo: `${HOJE}T10:40`,
      custoPecas: 123.45,
      custoMaoDeObra: 50,
    };
    a.relogio.agora = `${HOJE}T11:00`;
    expect((await a.post(tecnico, `/os/${id}/concluir`, concluir)).statusCode).toBe(403);
    const sem = await a.post(chefe, `/os/${id}/concluir`, concluir);
    expect(sem.json().codigo).toBe('sem-volta-ao-uso');
    const ok = await a.post(chefe, `/os/${id}/concluir`, { ...concluir, voltaAoUso: `${HOJE}T10:45` });
    expect(ok.statusCode).toBe(200);
    const cedo = await a.post(chefe, `/os/${id}/encerrar`, { versao: 4, aceite: true });
    expect(cedo.json().codigo).toBe('aceite-ainda-no-prazo');
    const d = (await a.get(setor, `/os/${id}`)).json();
    expect(d.acoes).toEqual(['encerrar']);
    expect(d.souSolicitante).toBe(true);
    expect((await a.get(chefe, `/os/${id}`)).json().souSolicitante).toBe(false);
    expect(d.custos).toEqual({ pecas: 123.45, maoDeObra: 50, terceiros: 0, total: 173.45 });
    expect(d.paradaFim).toBe(`${HOJE}T10:45`);
    expect(d.alerta).toBeNull();
    const fim = await a.post(setor, `/os/${id}/encerrar`, { versao: 4, aceite: true });
    expect(fim.json()).toMatchObject({ versao: 5, mensagem: 'Ordem de serviço encerrada.' });
    const e = (await a.get(chefe, `/os/${id}`)).json();
    expect(e.eventos.map((x: { para: string }) => x.para)).toEqual([
      'aberta',
      'emAtendimento',
      'aguardandoPeca',
      'concluida',
      'encerrada',
    ]);
    expect(e.solucao).toMatchObject({ situacao: 'cumprido' });
    expect(e.acoes).toEqual([]);
    // O documento da OS em PDF/A (o conteúdo é do teste de documentos.spec; sem o Gotenberg no ar, 503).
    const doc = await a.get(setor, `/os/${id}/documento`);
    expect([200, 503]).toContain(doc.statusCode);
    if (doc.statusCode === 200) {
      expect(doc.headers['content-type']).toContain('application/pdf');
      expect(doc.headers['content-disposition']).toContain(`os-${e.numero}.pdf`);
    }
    expect((await a.get(chefe, '/os/999999/documento')).statusCode).toBe(404);
  });

  it('a recusa do aceite reabre; a manutenção encerra depois do prazo do aceite; o cancelamento fecha a parada', async () => {
    a.relogio.agora = `${HOJE}T12:00`;
    const { id } = (
      await abrir(setor, { centroCusto: 102, natureza: 'predial', local: 'Sala de espera' })
    ).json();
    await a.post(chefe, `/os/${id}/assumir`, { versao: 1, prioridade: 'baixa' });
    const c = {
      causa: 'outra',
      solucao: 'Troca da lâmpada queimada',
      inicioReparo: `${HOJE}T12:00`,
      fimReparo: `${HOJE}T12:00`,
    };
    await a.post(chefe, `/os/${id}/concluir`, { versao: 2, ...c });
    const semNota = await a.post(setor, `/os/${id}/encerrar`, { versao: 3, aceite: false });
    expect(semNota.statusCode).toBe(400);
    const reaberta = await a.post(setor, `/os/${id}/encerrar`, {
      versao: 3,
      aceite: false,
      nota: 'Continua piscando depois da troca',
    });
    expect(reaberta.json().mensagem).toBe('Ordem de serviço em atendimento.');
    await a.post(chefe, `/os/${id}/concluir`, { versao: 4, ...c });
    a.relogio.agora = '2026-10-31T13:00';
    const auto = await a.post(chefe, `/os/${id}/encerrar`, { versao: 5, aceite: true });
    expect(auto.json().mensagem).toBe('Ordem de serviço encerrada.');
    const p = (await abrir(setor, { equipamento: 9001, equipamentoParado: true })).json();
    const canc = await a.post(setor, `/os/${p.id}/cancelamento`, {
      versao: 1,
      motivo: 'Aberta em duplicidade por engano',
    });
    expect(canc.statusCode).toBe(200);
    expect((await a.get(chefe, `/os/${p.id}`)).json()).toMatchObject({
      situacao: 'cancelada',
      parado: false,
    });
  });

  it('W0-08: corrige a abertura com motivo antes de assumida; depois de assumida, 409', async () => {
    a.relogio.agora = `${HOJE}T13:00`;
    const { id } = (await abrir(setor, { equipamento: 9001 })).json();
    const d0 = (await a.get(setor, `/os/${id}`)).json();
    expect(d0.podeCorrigir).toBe(true);
    const corr = {
      versao: 1,
      equipamento: 9001,
      centroCusto: 102,
      descricao: 'Não liga depois da queda de energia; tela apagada',
      prioridadeSugerida: 'alta',
      motivo: 'Faltou dizer que a tela não acende',
    };
    const semMotivo = await a.post(setor, `/os/${id}/correcao`, { ...corr, motivo: undefined });
    expect(semMotivo.statusCode).toBe(400);
    const naoExiste = await a.post(setor, `/os/${id}/correcao`, { ...corr, equipamento: 999999 });
    expect(naoExiste.json().codigo).toBe('equipamento-inexistente');
    const ok = await a.post(setor, `/os/${id}/correcao`, corr);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ versao: 2 });
    const d1 = (await a.get(setor, `/os/${id}`)).json();
    expect(d1.descricao).toBe(corr.descricao);
    const ev = d1.eventos.find((e: { de: string; para: string }) => e.de === 'aberta' && e.para === 'aberta');
    expect(ev.nota).toContain('Faltou dizer que a tela não acende');
    expect(ev.nota).toContain('prioridadeSugerida: media');
    const igual = await a.post(setor, `/os/${id}/correcao`, { ...corr, versao: 2 });
    expect(igual.json().codigo).toBe('sem-mudanca');
    const velha = await a.post(setor, `/os/${id}/correcao`, {
      ...corr,
      versao: 1,
      prioridadeSugerida: 'baixa',
    });
    expect(velha.json().codigo).toBe('desatualizado');
    expect((await a.post(tecnico, `/os/${id}/assumir`, { versao: 2, prioridade: 'alta' })).statusCode).toBe(
      200,
    );
    const depois = await a.post(setor, `/os/${id}/correcao`, {
      ...corr,
      versao: 3,
      prioridadeSugerida: 'baixa',
    });
    expect(depois.statusCode).toBe(409);
    expect(depois.json().codigo).toBe('os-assumida');
    expect((await a.get(setor, `/os/${id}`)).json().podeCorrigir).toBe(false);
  });

  it('o contrato de manutenção acionado tem de cobrir o equipamento', async () => {
    const { id } = (await abrir(chefe, { centroCusto: 104, equipamento: 9003 })).json();
    const fora = await a.post(chefe, `/os/${id}/assumir`, {
      versao: 1,
      prioridade: 'media',
      executor: 'contrato',
      cobertura: 9101,
    });
    expect(fora.json().codigo).toBe('fora-do-contrato');
    const o2 = (await abrir(chefe, { centroCusto: 101, equipamento: 9002 })).json();
    const ok = await a.post(chefe, `/os/${o2.id}/assumir`, {
      versao: 1,
      prioridade: 'media',
      executor: 'contrato',
      cobertura: 9101,
    });
    expect(ok.statusCode).toBe(200);
    expect((await a.get(chefe, `/os/${o2.id}`)).json()).toMatchObject({
      executor: 'contrato',
      cobertura: { id: 9101, fornecedor: { nome: 'Engenharia Clínica Sintética' }, vigente: true },
    });
  });
});

describe('equipamentos e contratos de manutenção', () => {
  const novo = {
    codigo: 'eq-novo-01',
    nome: 'Desfibrilador',
    tipo: 'medico',
    criticidade: 'critica',
    classeRisco: 'III',
    centroCusto: 104,
    recurso: { tipo: 'agendaExame', id: 60 },
  };

  it('cadastra, recusa o código repetido, o setor inativo e o recurso que não existe; altera e desativa com motivo', async () => {
    const r = await a.post(chefe, '/equipamentos', novo);
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect((await a.post(chefe, '/equipamentos', novo)).json().codigo).toBe('codigo-repetido');
    expect(
      (await a.post(chefe, '/equipamentos', { ...novo, codigo: 'X-2', centroCusto: 199 })).json().codigo,
    ).toBe('setor-inativo');
    expect(
      (
        await a.post(chefe, '/equipamentos', {
          ...novo,
          codigo: 'X-3',
          recurso: { tipo: 'agendaExame', id: 1 },
        })
      ).json().codigo,
    ).toBe('recurso-inexistente');
    expect((await a.post(tecnico, '/equipamentos', { ...novo, codigo: 'X-4' })).statusCode).toBe(403);
    const ficha = (await a.get(chefe, `/equipamentos/${id}`)).json();
    expect(ficha).toMatchObject({
      codigo: 'EQ-NOVO-01',
      setor: { codigo: '104', nome: 'UTI adulto (sintético)' },
      recurso: { tipo: 'agendaExame', id: 60, nome: 'Ecocardiograma (sintético)' },
      planos: [],
    });
    const desat = await a.post(chefe, `/equipamentos/${id}`, { ...novo, versao: 1, situacao: 'desativado' });
    expect(desat.statusCode).toBe(400);
    const ok = await a.post(chefe, `/equipamentos/${id}`, {
      ...novo,
      versao: 1,
      situacao: 'desativado',
      motivo: 'Sem conserto segundo o fabricante',
    });
    expect(ok.json()).toMatchObject({ versao: 2, mensagem: 'Equipamento EQ-NOVO-01 desativado.' });
    const lista = (await a.get(chefe, '/equipamentos?situacao=desativado')).json();
    expect(lista.itens.map((e: { id: number }) => e.id)).toEqual([id]);
    expect((await abrir(chefe, { centroCusto: 104, equipamento: id })).json().codigo).toBe(
      'equipamento-desativado',
    );
  });

  it('o bem patrimonial pela busca do patrimônio; o baixado e o que não existe recusados; a ficha mostra a plaqueta', async () => {
    const bens = (await a.get(chefe, '/bens?termo=PAT')).json();
    expect(bens).toEqual([{ id: 7001, plaqueta: 'PAT-000001', descricao: 'DESFIBRILADOR SINTETICO' }]);
    expect((await a.get(chefe, '/bens?termo=P')).json()).toEqual([]);
    expect((await a.get(tecnico, '/bens?termo=PAT')).statusCode).toBe(403);
    const comBem = { ...novo, codigo: 'EQ-BEM-01' };
    for (const bemPatrimonial of [7002, 9999])
      expect((await a.post(chefe, '/equipamentos', { ...comBem, bemPatrimonial })).json().codigo).toBe(
        'bem-inexistente',
      );
    const r = await a.post(chefe, '/equipamentos', { ...comBem, bemPatrimonial: 7001 });
    expect(r.statusCode).toBe(201);
    expect((await a.get(chefe, `/equipamentos/${r.json().id}`)).json()).toMatchObject({
      bemPatrimonial: 7001,
      bem: { plaqueta: 'PAT-000001' },
    });
  });

  it('o contrato de manutenção com os equipamentos; o número repetido do fornecedor; o fornecedor que não existe', async () => {
    const cob = {
      fornecedor: 7002,
      numero: 'CT-AR-1',
      cobertura: 'preventiva',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      equipamentos: [9004],
      valorMensal: 1200.5,
    };
    expect((await a.post(chefe, '/coberturas', cob)).statusCode).toBe(201);
    expect((await a.post(chefe, '/coberturas', cob)).json().codigo).toBe('contrato-repetido');
    expect((await a.post(chefe, '/coberturas', { ...cob, numero: 'X', fornecedor: 1 })).json().codigo).toBe(
      'fornecedor-inexistente',
    );
    const l = (await a.get(chefe, '/coberturas?equipamento=9004')).json();
    expect(l).toEqual([
      expect.objectContaining({
        numero: 'CT-AR-1',
        fornecedor: { codigo: '7002', nome: 'Climatização Sintética' },
        vigente: true,
        equipamentos: [9004],
        valorMensal: 1200.5,
      }),
    ]);
    expect((await a.get(chefe, '/fornecedores?termo=clima')).json()).toEqual([
      { codigo: 7002, nome: 'Climatização Sintética' },
    ]);
    expect((await a.get(chefe, '/recursos?tipo=salaCirurgica')).json()).toEqual([
      { id: 3, nome: 'Sala 3 (sintética)', ativo: true },
    ]);
    expect((await a.get(chefe, '/recursos?tipo=x')).statusCode).toBe(400);
  });

  it('W0-08: altera o contrato pela versão, encerra com motivo e exclui só sem vínculo (409 com quantos e quais)', async () => {
    const criado = await a.post(chefe, '/coberturas', {
      fornecedor: 7002,
      numero: 'CT-W008',
      cobertura: 'integral',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      equipamentos: [9004],
      slaHoras: 8,
    });
    const id = criado.json().id as number;
    expect((await a.get(chefe, `/coberturas/${id}`)).json()).toMatchObject({
      versao: 1,
      ativa: true,
      versoes: [],
    });
    const alteracao = {
      versao: 1,
      inicio: '2026-01-01',
      fim: '2027-06-30',
      equipamentos: [9004, 9003],
      slaHoras: 4,
      valorMensal: 900,
      motivo: 'Aditivo de prazo e inclusão do equipamento',
    };
    expect((await a.put(tecnico, `/coberturas/${id}`, alteracao)).statusCode).toBe(403);
    expect((await a.put(chefe, `/coberturas/${id}`, { ...alteracao, motivo: '' })).statusCode).toBe(400);
    expect((await a.put(chefe, `/coberturas/${id}`, { ...alteracao, numero: 'OUTRO' })).statusCode).toBe(400);
    const alt = await a.put(chefe, `/coberturas/${id}`, alteracao);
    expect(alt.statusCode).toBe(200);
    expect(alt.json()).toMatchObject({ versao: 2 });
    const velho = await a.put(chefe, `/coberturas/${id}`, alteracao);
    expect(velho.statusCode).toBe(409);
    expect(velho.json().codigo).toBe('desatualizado');
    const det = (await a.get(chefe, `/coberturas/${id}`)).json();
    expect(det).toMatchObject({
      versao: 2,
      fim: '2027-06-30',
      slaHoras: 4,
      valorMensal: 900,
      equipamentos: [9003, 9004],
    });
    expect(det.versoes).toEqual([
      expect.objectContaining({
        versao: 1,
        operacao: 'alteracao',
        fim: '2026-12-31',
        equipamentos: [9004],
        motivo: 'Aditivo de prazo e inclusão do equipamento',
      }),
    ]);
    // O contrato da semente tem um plano ativo (9201, no equipamento 9001): retirar o equipamento, encerrar e excluir
    // são recusados (nada muda).
    const retirar = await a.put(chefe, '/coberturas/9101', {
      versao: 1,
      inicio: '2026-01-01',
      fim: '2026-12-31',
      equipamentos: [9002],
      motivo: 'Tirar o monitor do contrato',
    });
    expect(retirar.statusCode).toBe(409);
    expect(retirar.json().codigo).toBe('equipamento-com-plano');
    const enc9101 = await a.post(chefe, '/coberturas/9101/encerramento', {
      versao: 1,
      data: '2026-11-18',
      motivo: 'Fornecedor saiu da região',
    });
    expect(enc9101.json().codigo).toBe('contrato-com-planos');
    const exc9101 = await a.post(chefe, '/coberturas/9101/exclusao', {
      versao: 1,
      motivo: 'Registrado por engano',
    });
    expect(exc9101.statusCode).toBe(409);
    expect(exc9101.json()).toMatchObject({ codigo: 'com-dependentes' });
    expect(exc9101.json().detail).toMatch(/1 registro em Planos de manutenção/u);
    expect(exc9101.json().dependentes).toContainEqual(
      expect.objectContaining({ rotulo: 'Planos de manutenção', quantidade: 1, origem: 'fk' }),
    );
    expect(exc9101.json().podeInativar).toBe(true);
    expect((await a.get(chefe, '/coberturas/9101')).json()).toMatchObject({
      versao: 1,
      ativa: true,
      equipamentos: [9001, 9002],
    });
    // Encerrar: a data dentro da vigência e com motivo; depois, não se altera mais; excluir (sem vínculo) apaga.
    const fora = await a.post(chefe, `/coberturas/${id}/encerramento`, {
      versao: 2,
      data: '2025-06-01',
      motivo: 'Fornecedor saiu da região',
    });
    expect(fora.json().codigo).toBe('data-fora-da-vigencia');
    expect(
      (await a.post(chefe, `/coberturas/${id}/encerramento`, { versao: 2, data: '2026-11-18' })).statusCode,
    ).toBe(400);
    const enc = await a.post(chefe, `/coberturas/${id}/encerramento`, {
      versao: 2,
      data: '2026-11-18',
      motivo: 'Fornecedor saiu da região',
    });
    expect(enc.json()).toMatchObject({ versao: 3, mensagem: 'Contrato de manutenção encerrado.' });
    expect((await a.put(chefe, `/coberturas/${id}`, { ...alteracao, versao: 3 })).json().codigo).toBe(
      'contrato-encerrado',
    );
    const lista = (await a.get(chefe, '/coberturas?equipamento=9003')).json();
    expect(lista).toEqual([
      expect.objectContaining({
        id,
        ativa: false,
        vigente: false,
        encerradaEm: '2026-11-18',
        motivoEncerramento: 'Fornecedor saiu da região',
      }),
    ]);
    expect((await a.post(chefe, `/coberturas/${id}/exclusao`, { versao: 3 })).statusCode).toBe(400);
    const exc = await a.post(chefe, `/coberturas/${id}/exclusao`, {
      versao: 3,
      motivo: 'Registrado por engano',
    });
    expect(exc.statusCode).toBe(200);
    expect((await a.get(chefe, `/coberturas/${id}`)).statusCode).toBe(404);
  });
});

describe('plano de manutenção (regra 2) e indicadores (regra 3)', () => {
  it('o painel com a vencida primeiro; a calibração sem laudo recusada; a reprovada abre a corretiva parada', async () => {
    a.relogio.hoje = HOJE;
    a.relogio.agora = `${HOJE}T14:00`;
    const p0 = (await a.get(chefe, '/plano/painel')).json();
    expect(p0.resumo).toEqual({ vencida: 1, aVencer: 1, emDia: 0 });
    expect(p0.itens.map((i: { plano: number }) => i.plano)).toEqual([9201, 9202]);
    expect(p0.itens[0]).toMatchObject({ situacao: 'vencida', exigeLaudo: true, proxima: '2025-10-01' });
    const semLaudo = await a.post(chefe, '/plano/9201/execucao', {
      versao: 1,
      data: HOJE,
      resultado: 'aprovado',
    });
    expect(semLaudo.json().codigo).toBe('laudo-obrigatorio');
    const ok = await a.post(chefe, '/plano/9201/execucao', {
      versao: 1,
      data: HOJE,
      resultado: 'aprovado',
      laudo: 900,
    });
    expect(ok.statusCode).toBe(201);
    expect(
      (
        await a.post(chefe, '/plano/9201/execucao', {
          versao: 1,
          data: HOJE,
          resultado: 'aprovado',
          laudo: 1,
        })
      ).json().codigo,
    ).toBe('desatualizado');
    const rep = await a.post(chefe, '/plano/9202/execucao', {
      versao: 1,
      data: HOJE,
      resultado: 'reprovado',
      observacao: 'Vazamento no circuito de infusão',
    });
    expect(rep.json().numero).toMatch(/^2026-/);
    expect((await a.get(chefe, '/equipamentos/9003')).json()).toMatchObject({ parado: true });
    const p1 = (await a.get(chefe, '/plano/painel')).json();
    expect(p1.itens.find((i: { plano: number }) => i.plano === 9201)).toMatchObject({
      situacao: 'emDia',
      proxima: '2027-10-28',
      ultimoResultado: 'aprovado',
    });
    const exec = (await a.get(chefe, '/plano/9202/execucoes')).json()[0];
    expect(exec).toMatchObject({ resultado: 'reprovado', osCorretiva: expect.any(Number) });
    // O laudo da execução em PDF/A, relido pelo equipamento do plano (sem o Gotenberg no ar, 503).
    const laudo = await a.get(chefe, `/equipamentos/9003/laudo/${exec.id}`);
    expect([200, 503]).toContain(laudo.statusCode);
    if (laudo.statusCode === 200) expect(laudo.headers['content-type']).toContain('application/pdf');
    expect((await a.get(chefe, `/equipamentos/9001/laudo/${exec.id}`)).statusCode).toBe(404);
    expect((await a.get(setor, `/equipamentos/9003/laudo/${exec.id}`)).statusCode).toBe(403);
    const novo = await a.post(chefe, '/plano', {
      equipamento: 9004,
      atividade: 'inspecao',
      periodicidade: { quantidade: 30, unidade: 'dias' },
      dataBase: '2026-11-30',
    });
    expect(novo.statusCode).toBe(201);
    const contratoSemCobertura = await a.post(chefe, '/plano', {
      equipamento: 9003,
      atividade: 'calibracao',
      periodicidade: { quantidade: 12, unidade: 'meses' },
      dataBase: '2026-11-30',
      executor: 'contrato',
      cobertura: 9101,
    });
    expect(contratoSemCobertura.json().codigo).toBe('fora-do-contrato');
    // W0-08: alterar pela versão lida, com motivo; a versão anterior fica visível; versão velha 409; quem só abre, 403.
    const idNovo = novo.json().id as number;
    const alteracao = {
      versao: 1,
      periodicidade: { quantidade: 60, unidade: 'dias' },
      dataBase: '2026-12-01',
      procedimento: 'Inspeção visual e teste funcional',
      motivo: 'Fabricante revisou o intervalo de inspeção',
    };
    expect((await a.put(setor, `/plano/${idNovo}`, alteracao)).statusCode).toBe(403);
    const semMotivo = await a.put(chefe, `/plano/${idNovo}`, { ...alteracao, motivo: '' });
    expect(semMotivo.statusCode).toBe(400);
    const alt = await a.put(chefe, `/plano/${idNovo}`, alteracao);
    expect(alt.statusCode).toBe(200);
    expect(alt.json()).toMatchObject({ id: idNovo, versao: 2 });
    const velhoPlano = await a.put(chefe, `/plano/${idNovo}`, alteracao);
    expect(velhoPlano.statusCode).toBe(409);
    expect(velhoPlano.json().codigo).toBe('desatualizado');
    const versoes = (await a.get(chefe, `/plano/${idNovo}/versoes`)).json();
    expect(versoes).toHaveLength(1);
    expect(versoes[0]).toMatchObject({
      versao: 1,
      periodicidade: { quantidade: 30, unidade: 'dias' },
      dataBase: '2026-11-30',
      motivo: 'Fabricante revisou o intervalo de inspeção',
    });
    const ficha = (await a.get(chefe, '/equipamentos/9004')).json();
    expect(ficha.planos.find((p: { plano: number }) => p.plano === idNovo)).toMatchObject({
      versao: 2,
      periodicidade: { quantidade: 60, unidade: 'dias' },
    });
    const detalhe = (await a.get(chefe, `/plano/${idNovo}`)).json();
    expect(detalhe).toMatchObject({
      id: idNovo,
      versao: 2,
      atividade: 'inspecao',
      dataBase: '2026-12-01',
      procedimento: 'Inspeção visual e teste funcional',
      versoes: [{ versao: 1 }],
    });
    expect((await a.get(chefe, '/plano/999999')).statusCode).toBe(404);
    const des = await a.post(chefe, `/plano/${idNovo}/ativo`, { versao: 2, ativo: false });
    expect(des.json().mensagem).toBe('Plano desativado.');
    const desativado = await a.put(chefe, `/plano/${idNovo}`, { ...alteracao, versao: 3 });
    expect(desativado.json().codigo).toBe('plano-desativado');
  });

  it('disponibilidade, MTBF e MTTR com as parcelas do período', async () => {
    const r = await a.get(chefe, `/indicadores?inicio=${HOJE}&fim=${HOJE}&equipamento=9001`);
    expect(r.statusCode).toBe(200);
    const x = r.json();
    expect(x.equipamentos).toBe(1);
    expect(x.parcelas.falhas).toBeGreaterThanOrEqual(1);
    expect(x.parcelas.horasParadas).toBeGreaterThan(0);
    expect(x.porEquipamento[0].equipamento).toMatchObject({ id: 9001, codigo: 'EQ-CC-001' });
    expect((await a.get(chefe, '/indicadores?inicio=2026-01-01&fim=2027-06-01')).statusCode).toBe(400);
    expect((await a.get(setor, `/indicadores?inicio=${HOJE}&fim=${HOJE}`)).statusCode).toBe(403);
  });
});

describe('tecnovigilância e recall (W0-08, M2)', () => {
  const eq = (codigo: string, x: Record<string, unknown>) =>
    a.post(chefe, '/equipamentos', {
      codigo,
      nome: 'Bomba de infusão volumétrica',
      tipo: 'medico',
      criticidade: 'alta',
      classeRisco: 'II',
      centroCusto: 104,
      fabricante: 'Infusão Sintética Ltda',
      modelo: 'BV-9',
      ...x,
    });
  const alerta = {
    numero: 'ALERTA-SINT-01',
    tipo: 'recall',
    titulo: 'Sensor de oclusão pode falhar',
    fabricante: 'INFUSAO SINTETICA LTDA',
    modelo: 'bv-9',
    serieInicio: 'SN-0900',
    serieFim: 'SN-1200',
    descricao: 'O sensor de oclusão pode não alarmar (dado sintético).',
    acao: 'Trocar a placa do sensor de oclusão conforme o boletim.',
  };

  it('registra, encontra os afetados pela faixa de série, gera uma OS por equipamento, abre a queixa da OS e recusa o órfão', async () => {
    const ids: number[] = [];
    for (const [codigo, serie] of [
      ['BI-T-01', 'SN-0950'],
      ['BI-T-02', 'SN-1100'],
      ['BI-T-03', 'SN-1300'],
      ['BI-T-04', null],
    ] as const) {
      const r = await eq(codigo, { numeroSerie: serie });
      expect(r.statusCode).toBe(201);
      ids.push(r.json().id as number);
    }
    const [q1, q2, , q4] = ids as [number, number, number, number];
    // Permissão: quem só abre OS não registra nem lê o alerta.
    expect((await a.post(setor, '/alertas', alerta)).statusCode).toBe(403);
    expect((await a.get(setor, '/alertas')).statusCode).toBe(403);
    expect(
      (await a.post(chefe, '/alertas', { ...alerta, serieInicio: 'SN-1200', serieFim: 'SN-0900' })).json()
        .codigo,
    ).toBe('faixa-invertida');
    expect((await a.post(chefe, '/alertas', { ...alerta, serieFim: null })).statusCode).toBe(400);
    const r = await a.post(chefe, '/alertas', alerta);
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;
    expect((await a.post(chefe, '/alertas', alerta)).json().codigo).toBe('numero-repetido');
    // A faixa: q1 e q2 afetados; q3 fora; q4 sem série, a conferir; os do semente sem o fabricante ficam fora.
    const d = (await a.get(chefe, `/alertas/${id}`)).json();
    expect(d).toMatchObject({ id, versao: 1, situacao: 'aberto', acoes: 0, importacaoAnvisa: false });
    expect(
      d.afetados.map((x: { equipamento: number; enquadramento: string }) => [x.equipamento, x.enquadramento]),
    ).toEqual([
      [q1, 'afetado'],
      [q2, 'afetado'],
      [q4, 'conferir'],
    ]);
    expect((await a.get(chefe, `/alertas/${id}/afetados`)).json()).toHaveLength(3);
    expect(
      (await a.get(chefe, '/alertas?situacao=aberto')).json().map((x: { id: number }) => x.id),
    ).toContain(id);
    // Alterar pela versão: o título muda; versão velha 409.
    const alt = await a.put(chefe, `/alertas/${id}`, {
      ...alerta,
      versao: 1,
      titulo: 'Sensor de oclusão: recall',
      motivo: 'Fabricante revisou o título do boletim',
    });
    expect(alt.json()).toMatchObject({ id, versao: 2 });
    expect(
      (
        await a.put(chefe, `/alertas/${id}`, { ...alerta, versao: 1, motivo: 'Outra pessoa tenta de novo' })
      ).json().codigo,
    ).toBe('desatualizado');
    // Ação de campo pela versão vista: uma OS por afetado; de novo, sem-afetados; a conferir quando pedido.
    expect((await a.post(chefe, `/alertas/${id}/acao-de-campo`, { versao: 1 })).json().codigo).toBe(
      'desatualizado',
    );
    const acao = await a.post(chefe, `/alertas/${id}/acao-de-campo`, { versao: 2 });
    expect(acao.statusCode).toBe(201);
    expect(acao.json()).toMatchObject({ versao: 3 });
    expect(acao.json().geradas.map((x: { equipamento: number }) => x.equipamento)).toEqual([q1, q2]);
    expect((await a.post(chefe, `/alertas/${id}/acao-de-campo`, { versao: 3 })).json().codigo).toBe(
      'sem-afetados',
    );
    const conf = await a.post(chefe, `/alertas/${id}/acao-de-campo`, { versao: 3, equipamentos: [q4] });
    expect(conf.json().geradas).toHaveLength(1);
    // O critério trava depois da primeira OS; o título segue mudando.
    expect(
      (
        await a.put(chefe, `/alertas/${id}`, {
          ...alerta,
          versao: 4,
          serieFim: 'SN-1250',
          motivo: 'Fabricante ampliou a faixa',
        })
      ).json().codigo,
    ).toBe('alerta-com-acao');
    const os1 = acao.json().geradas[0].os as number;
    const detalheOs = (await a.get(chefe, `/os/${os1}`)).json();
    expect(detalheOs).toMatchObject({
      natureza: 'inspecao',
      prioridade: 'alta',
      tecnovigilancia: { queixa: null, alerta: { id, numero: 'ALERTA-SINT-01' }, podeAbrirQueixa: true },
    });
    expect(detalheOs.descricao).toMatch(/^Ação de campo — Recall ALERTA-SINT-01/);
    // A queixa técnica da OS: uma por OS; a OS sem equipamento recusa; quem só abre OS, 403.
    const queixa = {
      tipo: 'queixaTecnica',
      descricao: 'Sensor de oclusão não alarmou no teste da ação de campo.',
    };
    expect((await a.post(setor, `/os/${os1}/queixa-tecnica`, queixa)).statusCode).toBe(403);
    const qx = await a.post(chefe, `/os/${os1}/queixa-tecnica`, queixa);
    expect(qx.statusCode).toBe(201);
    expect((await a.post(chefe, `/os/${os1}/queixa-tecnica`, queixa)).json().codigo).toBe('queixa-ja-aberta');
    expect((await a.get(chefe, `/os/${os1}`)).json().tecnovigilancia).toMatchObject({
      queixa: qx.json().id,
      podeAbrirQueixa: false,
    });
    const predial = await a.post(chefe, '/os', {
      natureza: 'predial',
      centroCusto: 104,
      local: 'Corredor da UTI',
      descricao: 'Lâmpada queimada no corredor',
    });
    expect(predial.statusCode).toBe(201);
    expect((await a.post(chefe, `/os/${predial.json().id}/queixa-tecnica`, queixa)).json().codigo).toBe(
      'os-sem-equipamento',
    );
    // Recusa de órfão: com OS e queixa ligadas, 409 com quantos e quais, oferecendo o encerramento.
    const exc = await a.del(chefe, `/alertas/${id}`, { versao: 4, motivo: 'Registrado por engano no teste' });
    expect(exc.statusCode).toBe(409);
    expect(exc.json()).toMatchObject({ codigo: 'com-dependentes', podeInativar: true });
    expect(exc.json().dependentes[0]).toMatchObject({ quantidade: 3 });
    // Encerrar com motivo; encerrado não muda nem gera OS.
    expect(
      (await a.post(chefe, `/alertas/${id}/encerramento`, { versao: 4, motivo: 'curto' })).statusCode,
    ).toBe(400);
    const enc = await a.post(chefe, `/alertas/${id}/encerramento`, {
      versao: 4,
      motivo: 'Ação de campo concluída nos três equipamentos',
    });
    expect(enc.json()).toMatchObject({ versao: 5, mensagem: 'Alerta encerrado.' });
    expect(
      (
        await a.post(chefe, `/alertas/${id}/encerramento`, {
          versao: 5,
          motivo: 'Ação de campo concluída de novo',
        })
      ).json().codigo,
    ).toBe('alerta-encerrado');
    expect(
      (
        await a.put(chefe, `/alertas/${id}`, { ...alerta, versao: 5, motivo: 'Tentativa depois de encerrar' })
      ).json().codigo,
    ).toBe('alerta-encerrado');
    // O registrado por engano, sem vínculo, sai (exclusão física com motivo); depois, 404.
    const engano = (await a.post(chefe, '/alertas', { ...alerta, numero: 'ALERTA-ENGANO' })).json()
      .id as number;
    expect(
      (
        await a.del(chefe, `/alertas/${engano}`, { versao: 1, motivo: 'Registrado por engano no teste' })
      ).json(),
    ).toMatchObject({ ok: true });
    expect((await a.get(chefe, `/alertas/${engano}`)).statusCode).toBe(404);
    // A trilha: os eventos do alerta e da queixa.
    const codigos = a.trilha.eventos.map((l) => l.evento);
    for (const ev of [
      'manutencao.alerta.registrado',
      'manutencao.alerta.acaoDeCampo',
      'manutencao.os.queixaTecnica',
      'manutencao.alerta.excluido',
    ])
      expect(codigos).toContain(ev);
  });
});

describe('treinamento dos operadores e ciclo de vida (W0-08, M3)', () => {
  const eq = (codigo: string, x: Record<string, unknown> = {}) =>
    a.post(chefe, '/equipamentos', {
      codigo,
      nome: 'Monitor multiparamétrico',
      tipo: 'medico',
      criticidade: 'alta',
      classeRisco: 'II',
      centroCusto: 104,
      fabricante: 'Fabricante Sintético',
      modelo: 'MX-1',
      ...x,
    });

  it('exige cursos por modelo, lista aptos e pendentes, calcula o índice com as parcelas e registra o ciclo de vida', async () => {
    const r = await eq('MON-CV-01', { bemPatrimonial: 7001 });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;
    // Sem curso exigido, ninguém é listado.
    expect((await a.get(chefe, `/equipamentos/${id}/operadores`)).json()).toEqual({
      cursos: [],
      aptos: [],
      pendentes: [],
    });
    // O catálogo do treinamento (só leitura) e o vínculo pelo modelo, comparado sem acento nem caixa.
    const catalogo = (await a.get(chefe, '/modelos/cursos/catalogo')).json() as {
      id: number;
      ativo: boolean;
    }[];
    expect(catalogo.map((c) => c.id)).toEqual([701, 702, 703]);
    expect((await a.get(setor, '/modelos/cursos/catalogo')).statusCode).toBe(403);
    expect(
      (await a.post(setor, '/modelos/cursos', { fabricante: 'X', modelo: 'Y', curso: 701 })).statusCode,
    ).toBe(403);
    const v1 = await a.post(chefe, '/modelos/cursos', {
      fabricante: 'fabricante sintético',
      modelo: 'mx-1',
      curso: 701,
    });
    expect(v1.statusCode).toBe(201);
    expect(
      (
        await a.post(chefe, '/modelos/cursos', {
          fabricante: 'FABRICANTE SINTETICO',
          modelo: 'MX-1',
          curso: 701,
        })
      ).json().codigo,
    ).toBe('vinculo-repetido');
    expect(
      (
        await a.post(chefe, '/modelos/cursos', {
          fabricante: 'Fabricante Sintético',
          modelo: 'MX-1',
          curso: 703,
        })
      ).json().codigo,
    ).toBe('curso-inativo');
    const v2 = await a.post(chefe, '/modelos/cursos', {
      fabricante: 'Fabricante Sintético',
      modelo: 'MX-1',
      curso: 702,
    });
    expect(v2.statusCode).toBe(201);
    const idV2 = v2.json().id as number;
    const doModelo = (
      await a.get(chefe, '/modelos/cursos?fabricante=Fabricante%20Sint%C3%A9tico&modelo=MX-1')
    ).json();
    expect(doModelo.map((c: { curso: number; fabricante: string }) => [c.curso, c.fabricante])).toEqual([
      [701, 'FABRICANTE SINTETICO'],
      [702, 'FABRICANTE SINTETICO'],
    ]);
    // Aptos: todos os cursos exigidos, dentro da validade; pendentes: o que falta ou venceu.
    const ops = (await a.get(chefe, `/equipamentos/${id}/operadores`)).json();
    expect(ops.aptos.map((x: { vinculo: number }) => x.vinculo)).toEqual([801]);
    expect(ops.aptos[0]).toMatchObject({ nome: 'Ana Operadora Sintética', validoAte: '2099-01-10' });
    expect(ops.pendentes).toEqual([
      expect.objectContaining({ vinculo: 802, faltam: [702], vencidos: [] }),
      expect.objectContaining({ vinculo: 803, faltam: [], vencidos: [701] }),
    ]);
    // Deixar de exigir: motivo obrigatório; depois o Bruno fica apto.
    expect((await a.del(chefe, `/modelos/cursos/${idV2}`, { motivo: 'curto' })).statusCode).toBe(400);
    expect(
      (
        await a.del(chefe, `/modelos/cursos/${idV2}`, {
          motivo: 'O fabricante dispensou o curso de segurança',
        })
      ).json(),
    ).toMatchObject({ ok: true });
    const ops2 = (await a.get(chefe, `/equipamentos/${id}/operadores`)).json();
    expect(ops2.aptos.map((x: { vinculo: number }) => x.vinculo)).toEqual([801, 802]);
    expect(
      (await a.del(chefe, '/modelos/cursos/999999', { motivo: 'Não existe este vínculo' })).statusCode,
    ).toBe(404);

    // Índice de obsolescência: idade da aquisição do bem (120 de 120 meses = 40), custo sem OS (0) e 2 corretivas
    // na janela (2 de 6 = 10); com a incorporação registrada, a idade conta dela.
    for (const d of ['Tela apagou', 'Alarme não soa'])
      await abrir(chefe, { centroCusto: 104, equipamento: id, descricao: d });
    const ind = (await a.get(chefe, `/equipamentos/${id}/obsolescencia`)).json();
    expect(ind).toMatchObject({
      indice: 50,
      faixa: 'acompanhar',
      idade: { pontos: 40, peso: 40, idadeMeses: 120, vidaUtilMeses: 120 },
      custo: { pontos: 0, peso: 30, custoCent: 0, valorCent: 1_000_000 },
      falhas: { pontos: 10, peso: 30, corretivas: 2, teto: 6 },
    });
    expect(ind.indice).toBe(ind.idade.pontos + ind.custo.pontos + ind.falhas.pontos);

    // Ciclo de vida: fatos novos na ordem; a desativação marca o equipamento; o descarte exige laudo e destino.
    const ev = (x: Record<string, unknown>) =>
      a.post(chefe, `/equipamentos/${id}/eventos`, { autorizadoPor: 'Gerente sintético', ...x });
    expect(
      (
        await ev({
          tipo: 'incorporacao',
          data: '2021-10-28',
          motivo: 'Recebido e aceito pela engenharia clínica',
        })
      ).statusCode,
    ).toBe(201);
    expect((await a.get(chefe, `/equipamentos/${id}/obsolescencia`)).json().idade).toMatchObject({
      idadeMeses: 60,
      pontos: 20,
    });
    expect(
      (
        await ev({ tipo: 'incorporacao', data: '2021-10-29', motivo: 'Incorporação registrada de novo' })
      ).json().codigo,
    ).toBe('evento-repetido');
    expect(
      (
        await ev({
          tipo: 'descarte',
          data: HOJE,
          motivo: 'Descarte antes da desativação',
          documento: 'CERT-1',
          destino: 'residuo',
        })
      ).json().codigo,
    ).toBe('sem-desativacao');
    expect(
      (await ev({ tipo: 'desativacao', data: '2026-12-01', motivo: 'Desativação com data no futuro' })).json()
        .codigo,
    ).toBe('data-futura');
    expect(
      (
        await ev({ tipo: 'desativacao', data: '2020-01-01', motivo: 'Desativação antes da incorporação' })
      ).json().codigo,
    ).toBe('fora-de-ordem');
    expect(
      (await ev({ tipo: 'desativacao', data: HOJE, motivo: 'Fim da vida útil segundo o índice' })).statusCode,
    ).toBe(201);
    expect((await a.get(chefe, `/equipamentos/${id}`)).json()).toMatchObject({ situacao: 'desativado' });
    expect(
      (await ev({ tipo: 'descarte', data: HOJE, motivo: 'Descarte sem o certificado' })).statusCode,
    ).toBe(400);
    expect(
      (
        await ev({
          tipo: 'descarte',
          data: HOJE,
          motivo: 'Destinado como resíduo de equipamento',
          documento: 'CERT-DEST-01',
          destino: 'residuo',
          valorObtidoCent: 0,
        })
      ).statusCode,
    ).toBe(201);
    const eventos = (await a.get(chefe, `/equipamentos/${id}/eventos`)).json();
    expect(eventos.map((x: { tipo: string }) => x.tipo)).toEqual(['incorporacao', 'desativacao', 'descarte']);
    expect(eventos[2]).toMatchObject({
      documento: 'CERT-DEST-01',
      destino: 'residuo',
      autorizadoPor: 'Gerente sintético',
    });
    expect(
      (await ev({ tipo: 'incorporacao', data: HOJE, motivo: 'Depois do descarte nada mais' })).json().codigo,
    ).toBe('equipamento-descartado');
    // O descartado não volta ao parque.
    const ficha = (await a.get(chefe, `/equipamentos/${id}`)).json();
    const volta = await a.post(chefe, `/equipamentos/${id}`, {
      codigo: 'MON-CV-01',
      nome: 'Monitor multiparamétrico',
      tipo: 'medico',
      criticidade: 'alta',
      classeRisco: 'II',
      centroCusto: 104,
      fabricante: 'Fabricante Sintético',
      modelo: 'MX-1',
      bemPatrimonial: 7001,
      versao: ficha.versao,
      situacao: 'ativo',
    });
    expect(volta.statusCode).toBe(409);
    expect(volta.json().codigo).toBe('equipamento-descartado');
    // Permissão e trilha.
    expect((await a.post(setor, `/equipamentos/${id}/eventos`, { tipo: 'incorporacao' })).statusCode).toBe(
      403,
    );
    const codigos = a.trilha.eventos.map((l) => l.evento);
    for (const c of [
      'manutencao.cursoModelo.vinculado',
      'manutencao.cursoModelo.excluido',
      'manutencao.equipamento.evento',
    ])
      expect(codigos).toContain(c);
  });

  it('gera o documento do PGTS do cadastro em PDF/A, com a trilha', async () => {
    const r = await eq('MON-CV-02', { criticidade: 'critica', classeRisco: 'III', numeroSerie: 'SN-PGTS-2' });
    expect(r.statusCode).toBe(201);
    // O PGTS em PDF/A (o conteúdo é do pgts.spec; sem o Gotenberg no ar, 503).
    const doc = await a.get(chefe, '/equipamentos/pgts/documento');
    expect([200, 503]).toContain(doc.statusCode);
    if (doc.statusCode === 200) {
      expect(doc.headers['content-type']).toContain('application/pdf');
      expect(doc.headers['content-disposition']).toContain('pgts.pdf');
    }
    expect(a.trilha.eventos.map((l) => l.evento)).toContain('manutencao.pgts.gerado');
  });
});

describe('PMOC e infraestrutura crítica (W0-08, M4)', () => {
  it('instala os modelos prontos como planos versionados e emite o relatório do PMOC com o responsável técnico', async () => {
    const modelos = (await a.get(chefe, '/plano/modelos')).json() as {
      codigo: string;
      procedimento: string;
    }[];
    expect(modelos.map((m) => m.codigo)).toEqual([
      'pmocAr',
      'reservatorioAgua',
      'geradorEnergia',
      'gasesMedicinais',
    ]);
    const r = await a.post(chefe, '/equipamentos', {
      codigo: 'AR-PMOC-01',
      nome: 'Condicionador de ar split 36.000 BTU',
      tipo: 'infraestrutura',
      criticidade: 'media',
      centroCusto: 104,
      fabricante: 'Fabricante Sintético',
      modelo: 'SPLIT-36',
      numeroSerie: 'SN-AR-01',
    });
    expect(r.statusCode).toBe(201);
    const eqId = r.json().id as number;
    // Sem permissão de planejar: 403. Instalado: um plano comum com o roteiro e a periodicidade do modelo.
    expect(
      (await a.post(setor, '/plano/modelo', { equipamento: eqId, modelo: 'pmocAr', dataBase: HOJE }))
        .statusCode,
    ).toBe(403);
    const inst = await a.post(chefe, '/plano/modelo', {
      equipamento: eqId,
      modelo: 'pmocAr',
      dataBase: HOJE,
    });
    expect(inst.statusCode).toBe(201);
    const plano = inst.json().id as number;
    const det = (await a.get(chefe, `/plano/${plano}`)).json();
    expect(det).toMatchObject({
      atividade: 'preventiva',
      periodicidade: { quantidade: 1, unidade: 'meses' },
      modelo: { codigo: 'pmocAr', versao: 1 },
      versao: 1,
    });
    expect(det.procedimento).toContain('Lei 13.589/2018');
    // O mesmo modelo ativo duas vezes no equipamento: 409.
    const dup = await a.post(chefe, '/plano/modelo', { equipamento: eqId, modelo: 'pmocAr', dataBase: HOJE });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('modelo-instalado');
    // Os outros modelos no mesmo equipamento de infraestrutura entram (cada um é um plano).
    for (const modelo of ['reservatorioAgua', 'geradorEnergia', 'gasesMedicinais'])
      expect(
        (await a.post(chefe, '/plano/modelo', { equipamento: eqId, modelo, dataBase: HOJE })).statusCode,
      ).toBe(201);
    // Versionado: altera pela versão lida, com motivo; a versão velha devolve 409; a anterior fica guardada.
    const alteracao = {
      versao: 1,
      periodicidade: { quantidade: 1, unidade: 'meses' },
      dataBase: HOJE,
      antecedenciaDias: 5,
      procedimento: `${det.procedimento}\n9. Conferir o termostato da sala.`,
      executor: 'interno',
      cobertura: null,
      motivo: 'Inclusão do termostato no roteiro do PMOC',
    };
    expect((await a.put(chefe, `/plano/${plano}`, alteracao)).statusCode).toBe(200);
    expect((await a.put(chefe, `/plano/${plano}`, alteracao)).json().codigo).toBe('desatualizado');
    const depois = (await a.get(chefe, `/plano/${plano}`)).json();
    expect(depois).toMatchObject({ versao: 2, modelo: { codigo: 'pmocAr', versao: 1 } });
    expect(depois.versoes[0]).toMatchObject({
      versao: 1,
      motivo: 'Inclusão do termostato no roteiro do PMOC',
    });
    // A execução do plano do modelo (imutável, como qualquer execução).
    const ex = await a.post(chefe, `/plano/${plano}/execucao`, {
      versao: 2,
      data: HOJE,
      resultado: 'aprovado',
    });
    expect(ex.statusCode).toBe(201);
    // O painel mostra de onde veio o plano.
    const painel = (await a.get(chefe, '/plano/painel')).json() as {
      itens: { plano: number; modelo: string | null }[];
    };
    expect(painel.itens.find((i) => i.plano === plano)?.modelo).toBe('pmocAr');
    // O relatório do PMOC sem o responsável técnico cadastrado (dono): 409 com o aviso; período invertido: 409.
    const sem = await a.get(chefe, '/plano/pmoc/relatorio?de=2026-10-01&ate=2026-10-31');
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('pmoc-sem-responsavel');
    const inv = await a.get(chefe, '/plano/pmoc/relatorio?de=2026-10-31&ate=2026-10-01');
    expect(inv.json().codigo).toBe('periodo-invalido');
  });

  it('com o responsável técnico no parâmetro, o relatório sai em PDF/A, com a trilha', async () => {
    const b = await montar({
      parametros: {
        'manutencao.pmocResponsavelTecnico': 'Eng. Responsável Sintético; CREA-SP 0000000000; ART 0000000001',
      },
    });
    try {
      const s = await b.entrar('SINT.MANUTENCAO');
      const r = await b.post(s, '/equipamentos', {
        codigo: 'AR-PMOC-02',
        nome: 'Condicionador de ar central',
        tipo: 'infraestrutura',
        criticidade: 'alta',
        centroCusto: 104,
      });
      expect(r.statusCode).toBe(201);
      const inst = await b.post(s, '/plano/modelo', {
        equipamento: r.json().id,
        modelo: 'pmocAr',
        dataBase: '2026-09-28',
      });
      const plano = inst.json().id as number;
      expect(
        (
          await b.post(s, `/plano/${plano}/execucao`, {
            versao: 1,
            data: '2026-09-28',
            resultado: 'aprovado',
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await b.post(s, `/plano/${plano}/execucao`, {
            versao: 2,
            data: HOJE,
            resultado: 'aprovadoComRestricao',
            observacao: 'Filtro saturado trocado; dreno com caimento corrigido',
          })
        ).statusCode,
      ).toBe(201);
      // O PDF/A (o conteúdo, com a assinatura e a conta, é do pmoc.spec; sem o Gotenberg no ar, 503).
      const doc = await b.get(s, '/plano/pmoc/relatorio?de=2026-10-01&ate=2026-10-31');
      expect([200, 503]).toContain(doc.statusCode);
      if (doc.statusCode === 200) {
        expect(doc.headers['content-type']).toContain('application/pdf');
        expect(doc.headers['content-disposition']).toContain('pmoc-2026-10-01-2026-10-31.pdf');
      }
      expect(b.trilha.eventos.map((l) => l.evento)).toContain('manutencao.pmoc.gerado');
    } finally {
      await b.fechar();
    }
  });
});

describe('manutenção desligada (POL-3)', () => {
  it('a consulta segue e a gravação recusa com o motivo', async () => {
    const b = await montar({ semManutencao: true });
    try {
      const s = await b.entrar('SINT.MANUTENCAO');
      const p = (await b.get(s, '/apoio')).json();
      expect(p.gravacao.ligada).toBe(false);
      expect(p.gravacao.motivo).toMatch(/ainda não foi liberada/);
      const r = await b.post(s, '/os', {
        natureza: 'corretiva',
        centroCusto: 102,
        equipamento: 9001,
        descricao: 'Teste desligado',
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
      expect((await b.get(s, '/plano/painel')).statusCode).toBe(200);
    } finally {
      await b.fechar();
    }
  });
});
