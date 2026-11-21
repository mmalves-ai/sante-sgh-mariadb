// W0-07 (mercado M4) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a
// banco): a OS predial aberta num leito livre propõe o bloqueio por manutenção; confirmado o bloqueio ("OS <número>"),
// o encerramento da OS encerra o bloqueio e solicita a higienização. Com o parâmetro adt.osBloqueiaLeito desligado
// (o padrão), nada acontece. Dados sintéticos.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AVISOS_OS_NO_LEITO,
  bloqueioDaOs,
  leitoDoLocalDaOs,
  numeroOsDoBloqueio,
  PARAMETRO_OS_BLOQUEIA_LEITO,
  preservarVinculoOs,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { Module } from '@nestjs/common';
import { registroDeTeste } from '../cadastro/teste.spec-util.js';
import { FONTE_CONFIGURACAO } from '../config/public-api.js';
import { modulo as moduloManutencao } from '../manutencao/modulo.js';
import { modulo as moduloAdt } from './modulo.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { PortaManutencaoMemoria } from '../manutencao/porta-memoria.js';
import { tipoLimpezaPosManutencao } from './os-leito.js';
import { PortaAdtMemoria } from './porta-memoria.js';

@Module({})
class ConfiguracaoOsLeito {}

const HOJE = '2026-10-23';
const pasta = resolve(import.meta.dirname, '../../../../../.tmp/os-leito-spec');
interface Sessao {
  cookie: string;
  csrf: string;
}
interface LeitoMapa {
  chave: string;
  situacao: string;
  leito: { bloco: string; acomodacao: string; leito: string };
  estados: { estado: string; motivo?: string | null; observacao?: string | null }[];
}

async function montar(ligado: boolean, nome: string) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'configuracao_teste,cadastro,manutencao,adt' };
  const trilha = new RegistradorTrilhaMemoria();
  const cadastro = new PortaCadastroMemoria();
  const relogio = { hoje: HOJE, agora: `${HOJE}T09:00` };
  const manutencao = new PortaManutencaoMemoria(() => ({ ...relogio }));
  const painel = new FonteInternacaoMemoria({
    arquivoPorFora: resolve(pasta, `${nome}.json`),
    agora: () => Date.UTC(2026, 9, 23, 12, 0),
  });
  const adt = new PortaAdtMemoria(
    { estado: () => 'verde' },
    { painel, lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids) },
  );
  const configuracao = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: chavesIniciaisSinteticas,
    prerequisitosIniciais: prerequisitosIniciaisSinteticos,
    parametrosIniciais: (h: string) => [
      ...parametrosIniciaisSinteticos(h),
      ...(ligado
        ? [
            {
              id: 'w007-os-leito',
              chave: PARAMETRO_OS_BLOQUEIA_LEITO,
              nivel: 'estabelecimento' as const,
              alvo: h,
              valor: 'sim',
              vigenteDesde: '2026-10-01T00:00:00.000Z',
              vigenteAte: null,
              justificativa: 'Teste do W0-07 (M4)',
              autor: 'SINT.ADMIN',
            },
          ]
        : []),
    ],
  });
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: () => ({
          module: ConfiguracaoOsLeito,
          global: true,
          providers: [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }],
          exports: [FONTE_CONFIGURACAO],
        }),
        manutencao: (ctx) => moduloManutencao(ctx, { porta: manutencao }),
        adt: (ctx) => moduloAdt(ctx, { adt }),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const entrar = async (login: string): Promise<Sessao> => {
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
  };
  const post = (s: Sessao, url: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api${url}`,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload,
    });
  const mapa = async (s: Sessao) =>
    (await app.inject({ method: 'GET', url: '/api/leitos/mapa', headers: { cookie: s.cookie } })).json() as {
      leitos: LeitoMapa[];
    };
  return { app, relogio, adt, entrar, post, mapa };
}
type App = Awaited<ReturnType<typeof montar>>;

/**
 * Abre a OS predial no leito (pelo setor, ou por `abridor`), assume, conclui e encerra por quem abriu; devolve a
 * abertura e o encerramento.
 */
async function cicloDaOs(a: App, local: string, abridor = 'SINT.MANUTENCAO.SETOR') {
  const quemAbre = await a.entrar(abridor);
  const [tecnico, chefe] = [await a.entrar('SINT.MANUTENCAO.TECNICO'), await a.entrar('SINT.MANUTENCAO')];
  a.relogio.agora = `${HOJE}T09:00`;
  const aberta = await a.post(quemAbre, '/manutencao/os', {
    natureza: 'predial',
    centroCusto: 102,
    local,
    descricao: 'Troca da régua de gases do leito',
  });
  expect(aberta.statusCode, aberta.body).toBe(201);
  const id = aberta.json().id as number;
  const confirmar = async () => {
    a.relogio.agora = `${HOJE}T09:30`;
    expect(
      (await a.post(tecnico, `/manutencao/os/${id}/assumir`, { versao: 1, prioridade: 'alta' })).statusCode,
    ).toBe(200);
    a.relogio.agora = `${HOJE}T11:00`;
    const ok = await a.post(chefe, `/manutencao/os/${id}/concluir`, {
      versao: 2,
      causa: 'desgaste',
      solucao: 'Régua trocada',
      inicioReparo: `${HOJE}T09:40`,
      fimReparo: `${HOJE}T10:40`,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    // Encerra quem abriu (o solicitante).
    const fim = await a.post(quemAbre, `/manutencao/os/${id}/encerrar`, { versao: 3, aceite: true });
    expect(fim.statusCode, fim.body).toBe(200);
    return fim.json();
  };
  return { aberta: aberta.json(), confirmar };
}

/** Quem abre a OS (todo perfil de pessoa abre) e também pode bloquear o leito (leitos.bloqueio.criar). */
const QUEM_BLOQUEIA = 'SINT.INTERNACAO';
const local = (l: LeitoMapa) => `Leito ${l.leito.bloco} / ${l.leito.acomodacao} / ${l.leito.leito}`;

let ligado: App;
let desligado: App;
beforeAll(async () => {
  mkdirSync(pasta, { recursive: true });
  ligado = await montar(true, 'ligado');
  desligado = await montar(false, 'desligado');
});
afterAll(async () => {
  await ligado?.app.close();
  await desligado?.app.close();
  rmSync(pasta, { recursive: true, force: true });
});

describe('W0-07 (M4): o local da OS e o vínculo com o bloqueio', () => {
  const leitos = [
    { bloco: '2A', acomodacao: '201', leito: '01' },
    { bloco: '2A', acomodacao: '201', leito: '02' },
  ];
  it('reconhece a chave do mapa e o texto com rótulos e separadores; ambíguo ou outro local fica de fora', () => {
    expect(leitoDoLocalDaOs('2A|201|01', leitos)).toEqual(leitos[0]);
    expect(leitoDoLocalDaOs('Leito 2a / 201 - 02', leitos)).toEqual(leitos[1]);
    expect(leitoDoLocalDaOs('Bloco 2A acomodação 201 leito 02', leitos)).toEqual(leitos[1]);
    expect(leitoDoLocalDaOs('Corredor do 2º andar', leitos)).toBeNull();
    expect(leitoDoLocalDaOs('2A 201 03', leitos)).toBeNull();
    expect(leitoDoLocalDaOs(null, leitos)).toBeNull();
  });
  it('o bloqueio é da OS pela observação "OS <número>" (sem confundir OS 12 com OS 123)', () => {
    expect(bloqueioDaOs('OS 12', '12')).toBe(true);
    expect(bloqueioDaOs('os 12 — régua de gases', '12')).toBe(true);
    expect(bloqueioDaOs('OS 123', '12')).toBe(false);
    expect(bloqueioDaOs(null, '12')).toBe(false);
  });
  it('a alteração do bloqueio de uma OS preserva o prefixo "OS <número>" e o motivo (o elo com a OS)', () => {
    expect(numeroOsDoBloqueio('OS 2026-000123 - aguardando peça')).toBe('2026-000123');
    expect(numeroOsDoBloqueio('Troca (OS 12)')).toBeNull();
    const antes = { estado: 'bloqueio', motivo: 'manutencao', observacao: 'OS 2026-000123' };
    expect(preservarVinculoOs(antes, { motivo: 'manutencao', observacao: 'Aguardando peça' })).toEqual({
      ok: true,
      observacao: 'OS 2026-000123 - Aguardando peça',
    });
    expect(preservarVinculoOs(antes, { motivo: 'manutencao', observacao: 'os 2026-000123: peça' })).toEqual({
      ok: true,
      observacao: 'os 2026-000123: peça',
    });
    expect(preservarVinculoOs(antes, { motivo: 'manutencao', observacao: null })).toEqual({
      ok: true,
      observacao: 'OS 2026-000123',
    });
    expect(preservarVinculoOs(antes, { motivo: 'outro', observacao: 'OS 2026-000123' })).toMatchObject({
      ok: false,
      numero: '2026-000123',
    });
    const manual = { estado: 'bloqueio', motivo: 'manutencao', observacao: 'Coordenação' };
    expect(preservarVinculoOs(manual, { motivo: 'outro', observacao: 'x' })).toEqual({
      ok: true,
      observacao: 'x',
    });
  });
  it('a limpeza depois da manutenção é a terminal do cadastro (sem ela, a primeira)', () => {
    expect(
      tipoLimpezaPosManutencao([
        { codigo: 1, nome: 'CONCORRENTE' },
        { codigo: 4, nome: 'Terminal' },
      ]),
    ).toBe(4);
    expect(tipoLimpezaPosManutencao([{ codigo: 1, nome: 'CONCORRENTE' }])).toBe(1);
    expect(tipoLimpezaPosManutencao([])).toBeNull();
  });
});

describe('W0-07 (M4): OS em leito com o parâmetro ligado', () => {
  it('propõe o bloqueio; ao encerrar a OS, encerra o bloqueio e solicita a higienização', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const l = (await ligado.mapa(nir)).leitos.find((x) => x.situacao === 'livre' && x.estados.length === 0)!;
    expect(l).toBeTruthy();
    const { aberta, confirmar } = await cicloDaOs(ligado, local(l), QUEM_BLOQUEIA);
    expect(aberta.leito).toMatchObject({ chave: l.chave, propostaBloqueio: true, aviso: null });
    expect(aberta.leito.observacao).toBe(`OS ${aberta.numero}`);
    // Quem abriu confirma a proposta pelo bloqueio do mapa, com a observação que liga o bloqueio à OS.
    const bloq = await ligado.post(nir, '/leitos/estados', {
      leito: l.leito,
      estado: 'bloqueio',
      motivo: 'manutencao',
      observacao: aberta.leito.observacao,
    });
    expect(bloq.statusCode, bloq.body).toBe(201);
    const antes = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(antes.estados.map((x) => x.estado)).toContain('bloqueio');

    const fim = await confirmar();
    expect(fim.mensagem).toBe('Ordem de serviço encerrada.');
    expect(fim.leito).toMatchObject({ chave: l.chave, bloqueioEncerrado: true, aviso: null });
    expect(fim.leito.higienizacao).toBeGreaterThan(0);
    const depois = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(depois.estados.map((x) => x.estado)).not.toContain('bloqueio');
    expect(depois.situacao).toBe('higienizacao');
  });

  it('o bloqueio manual (sem a OS na observação) não é encerrado pela OS', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const l = (await ligado.mapa(nir)).leitos.find((x) => x.situacao === 'livre' && x.estados.length === 0)!;
    const { aberta, confirmar } = await cicloDaOs(ligado, l.chave, QUEM_BLOQUEIA);
    expect(aberta.leito.propostaBloqueio).toBe(true);
    expect(
      (
        await ligado.post(nir, '/leitos/estados', {
          leito: l.leito,
          estado: 'bloqueio',
          motivo: 'manutencao',
          observacao: 'Bloqueio da coordenação',
        })
      ).statusCode,
    ).toBe(201);
    const fim = await confirmar();
    expect(fim.leito).toMatchObject({ bloqueioEncerrado: false, higienizacao: null });
    expect(fim.leito.aviso).toBe('sem-bloqueio-da-os');
    const depois = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(depois.estados.map((x) => x.estado)).toContain('bloqueio');
  });

  it('alterar a observação do bloqueio no mapa e depois encerrar a OS: o elo fica e o bloqueio encerra', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const l = (await ligado.mapa(nir)).leitos.find((x) => x.situacao === 'livre' && x.estados.length === 0)!;
    const { aberta, confirmar } = await cicloDaOs(ligado, local(l));
    const obs = aberta.leito.observacao as string;
    expect(
      (
        await ligado.post(nir, '/leitos/estados', {
          leito: l.leito,
          estado: 'bloqueio',
          motivo: 'manutencao',
          observacao: obs,
        })
      ).statusCode,
    ).toBe(201);
    const alt = await ligado.post(nir, '/leitos/estados/alterar', {
      leito: l.leito,
      estado: 'bloqueio',
      observacao: 'Aguardando peça',
      justificativa: 'Peça em falta no almoxarifado',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    const mostrado = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(mostrado.estados.find((x) => x.estado === 'bloqueio')?.observacao).toBe(
      `${obs} - Aguardando peça`,
    );
    // Trocar o motivo do bloqueio da OS recusa (o bloqueio encerra com a OS).
    const motivo = await ligado.post(nir, '/leitos/estados/alterar', {
      leito: l.leito,
      estado: 'bloqueio',
      motivo: 'outro',
      justificativa: 'Tentativa de trocar o motivo',
    });
    expect(motivo.statusCode).toBe(409);
    expect(motivo.json().codigo).toBe('bloqueio-da-os');
    const fim = await confirmar();
    expect(fim.leito).toMatchObject({ chave: l.chave, bloqueioEncerrado: true });
    expect(fim.leito.higienizacao).toBeGreaterThan(0);
    const depois = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(depois.estados.map((x) => x.estado)).not.toContain('bloqueio');
  });

  it('o bloqueio da OS em outro leito (o local mudou) é achado pelo número e encerrado', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const livres = (await ligado.mapa(nir)).leitos.filter(
      (x) => x.situacao === 'livre' && x.estados.length === 0,
    );
    const [l1, l2] = livres;
    const { aberta, confirmar } = await cicloDaOs(ligado, local(l1!));
    expect(
      (
        await ligado.post(nir, '/leitos/estados', {
          leito: l2!.leito,
          estado: 'bloqueio',
          motivo: 'manutencao',
          observacao: aberta.leito.observacao,
        })
      ).statusCode,
    ).toBe(201);
    const fim = await confirmar();
    expect(fim.leito).toMatchObject({ chave: l2!.chave, bloqueioEncerrado: true });
    const depois = (await ligado.mapa(nir)).leitos.find((x) => x.chave === l2!.chave)!;
    expect(depois.estados.map((x) => x.estado)).not.toContain('bloqueio');
  });

  it('cancelar a OS encerra o bloqueio dela (sem higienização), e o bloqueio de outra OS fica', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const setor = await ligado.entrar('SINT.MANUTENCAO.SETOR');
    const [l, outro] = (await ligado.mapa(nir)).leitos.filter(
      (x) => x.situacao === 'livre' && x.estados.length === 0,
    );
    const { aberta } = await cicloDaOs(ligado, local(l!));
    for (const [leito, observacao] of [
      [l!.leito, aberta.leito.observacao],
      [outro!.leito, 'OS 9999-999999'],
    ] as const)
      expect(
        (
          await ligado.post(nir, '/leitos/estados', {
            leito,
            estado: 'bloqueio',
            motivo: 'manutencao',
            observacao,
          })
        ).statusCode,
      ).toBe(201);
    const c = await ligado.post(setor, `/manutencao/os/${aberta.id}/cancelamento`, {
      versao: 1,
      motivo: 'Aberta em duplicidade',
    });
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().leito).toMatchObject({ chave: l!.chave, bloqueioEncerrado: true, higienizacao: null });
    expect(c.json().leito.aviso).toBe('cancelada');
    const m = (await ligado.mapa(nir)).leitos;
    expect(m.find((x) => x.chave === l!.chave)!.estados.map((x) => x.estado)).not.toContain('bloqueio');
    expect(m.find((x) => x.chave === outro!.chave)!.estados.map((x) => x.estado)).toContain('bloqueio');
  });

  it('sem leitos.bloqueio.criar não há proposta (o botão daria 403): o aviso pede à hotelaria ou ao NIR', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const l = (await ligado.mapa(nir)).leitos.find((x) => x.situacao === 'livre' && x.estados.length === 0)!;
    const { aberta } = await cicloDaOs(ligado, local(l));
    expect(aberta.leito).toMatchObject({
      chave: l.chave,
      propostaBloqueio: false,
      aviso: 'sem-permissao-bloqueio',
      observacao: `OS ${aberta.numero}`,
    });
    // A pessoa do setor de fato não bloqueia (a recusa que a proposta provocaria).
    const setor = await ligado.entrar('SINT.MANUTENCAO.SETOR');
    const bloq = await ligado.post(setor, '/leitos/estados', {
      leito: l.leito,
      estado: 'bloqueio',
      motivo: 'manutencao',
      observacao: aberta.leito.observacao,
    });
    expect(bloq.statusCode).toBe(403);
  });

  it('leito ocupado: sem proposta e sem bloqueio adiado; o aviso é só o código (a tela traduz)', async () => {
    const nir = await ligado.entrar('SINT.INTERNACAO');
    const l = (await ligado.mapa(nir)).leitos.find((x) => x.situacao === 'ocupado');
    expect(l, 'a fonte sintética tem leito ocupado').toBeTruthy();
    const { aberta } = await cicloDaOs(ligado, local(l!), QUEM_BLOQUEIA);
    expect(aberta.leito).toMatchObject({ chave: l!.chave, propostaBloqueio: false, aviso: 'leito-ocupado' });
    expect(AVISOS_OS_NO_LEITO).toContain(aberta.leito.aviso);
  });

  it('OS fora de leito segue como antes (sem o campo do leito)', async () => {
    const { aberta } = await cicloDaOs(ligado, 'Corredor do 2º andar');
    expect(aberta.leito).toBeNull();
  });
});

describe('W0-07 (M4): OS em leito com o parâmetro desligado (padrão)', () => {
  it('nada acontece: sem proposta e o bloqueio fica', async () => {
    const nir = await desligado.entrar('SINT.INTERNACAO');
    const l = (await desligado.mapa(nir)).leitos.find(
      (x) => x.situacao === 'livre' && x.estados.length === 0,
    )!;
    const { aberta, confirmar } = await cicloDaOs(desligado, local(l));
    expect(aberta.leito).toBeNull();
    expect(
      (
        await desligado.post(nir, '/leitos/estados', {
          leito: l.leito,
          estado: 'bloqueio',
          motivo: 'manutencao',
          observacao: `OS ${aberta.numero}`,
        })
      ).statusCode,
    ).toBe(201);
    const fim = await confirmar();
    expect(fim.leito ?? null).toBeNull();
    const depois = (await desligado.mapa(nir)).leitos.find((x) => x.chave === l.chave)!;
    expect(depois.estados.map((x) => x.estado)).toContain('bloqueio');
    expect(depois.situacao).not.toBe('higienizacao');
  });
});
