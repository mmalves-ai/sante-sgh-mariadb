// M40 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o critério
// de liberação de cada setor da onda 2 (regra 1: as operações e o teste de invasão calculados; os demais itens
// registrados com evidência e data, sem dado pessoal), a ordem dos setores (campo 12), o Serrano depois (regra 8), a
// janela sem versão (regra 16), os códigos a confirmar (regra 14), o plano de recolhimento (regra 4), o acompanhamento
// agregado (campo 4) e o lote de um setor da onda 2: em dev/ci com o aviso; fora de dev/ci, recusado.
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { ServicoMigracao } from './aplicacao/servico.js';
import { PortaCoexistenciaMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  CATALOGO_OPERACOES: resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'),
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m40-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const put = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url, headers: h(s), payload: payload as Record<string, unknown> });
const M = '/api/administracao/coexistencia/migracao';
const J = 'Registro sintético do comitê de coexistência';

interface ItemTela {
  item: string;
  ok: boolean;
  origem: string;
  situacao: string;
  falta: string | null;
  detalhe: string;
}
interface SetorTela {
  setor: string;
  passo: number;
  podeLiberar: boolean;
  itens: ItemTela[];
  operacoes: { nome: string; estado: string; fora: boolean }[];
  recursosSoNoNovo: { chave: string; imprime: string }[];
  recolhimento: { chaves: string[]; bloquear: string[] };
  registrados: { item: string; situacao: string; alteradoPor: string }[];
}

describe('onda 2: critério de liberação por setor e acompanhamento', { timeout: 30_000 }, () => {
  it('o painel: sete passos, setores com os itens do critério, calculados marcados, sem citar o outro sistema', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, `${M}/onda2`);
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.ordem).toHaveLength(7);
    expect(p.setores.map((x: SetorTela) => x.setor)).toEqual([
      'internacao-leitos',
      'same',
      'pronto-atendimento',
      'centro-cirurgico',
      'sadt',
      'medicos',
      'enfermagem',
      'higienizacao',
    ]);
    const enf: SetorTela = p.setores.find((x: SetorTela) => x.setor === 'enfermagem');
    expect(enf.passo).toBe(6);
    expect(enf.podeLiberar).toBe(false);
    const itens = Object.fromEntries(enf.itens.map((i) => [i.item, i]));
    expect(itens['operacoes-conferidas']?.origem).toBe('calculado');
    // No estabelecimento sintético, o catálogo não declara estado: tudo especificada, desligado (POL-3).
    expect(itens['operacoes-conferidas']?.falta).toMatch(
      /^todas as \d+ operações de gravação do setor estão desligadas/,
    );
    // Sem o painel da homologação gerado, o teste de invasão bloqueia (falha fechada).
    expect(itens['pentest-sem-critico']).toMatchObject({ origem: 'calculado', ok: false });
    expect(itens['unidade-piloto']).toMatchObject({ origem: 'registrado', situacao: 'pendente' });
    expect(itens['relatorio-contingencia']).toBeDefined();
    expect(enf.recursosSoNoNovo.map((x) => x.chave)).toContain('enfermagem.sinaisVitais');
    // As operações desligadas pela POL-3 ficam fora e não seguram o setor (D-OPS-40).
    expect(enf.operacoes.find((o) => o.nome === 'enfermagem.aprazarHorario')).toMatchObject({ fora: true });
    const same: SetorTela = p.setores.find((x: SetorTela) => x.setor === 'same');
    expect(same.itens.some((i) => i.item === 'relatorio-contingencia')).toBe(false);
    expect(p.codigosAConfirmar.map((x: { tabela: string }) => x.tabela)).toContain('SILANEXA');
    expect(p.versao.janelas).toHaveLength(2);
    expect(typeof p.versao.permitida).toBe('boolean');
    expect(JSON.stringify(p)).not.toMatch(/spdata/i);
  });

  it('registrar itens: os calculados são recusados; evidência sem documento nem e-mail; 404 fora da onda; 403 sem permissão', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = `${M}/onda2/criterio/enfermagem`;
    const um = (x: Record<string, unknown>) => ({ itens: [x], justificativa: J });
    for (const item of ['operacoes-conferidas', 'pentest-sem-critico'])
      expect(
        (await put(s, url, um({ item, situacao: 'cumprido', evidencia: 'ata 1', em: '2026-12-01' })))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await put(
          s,
          url,
          um({
            item: 'aceite-jornada',
            situacao: 'cumprido',
            evidencia: 'ata 123.456.789-09',
            em: '2026-12-01',
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await put(s, url, um({ item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'ata 7' })))
        .statusCode,
    ).toBe(400);
    expect(
      (await put(s, `${M}/onda2/criterio/agendamento`, um({ item: 'aceite-jornada', situacao: 'pendente' })))
        .statusCode,
    ).toBe(404);
    // "Não se aplica" não cumpre a autorização do dono, os ensaios nem as condições do setor; cabe em estações e apoio.
    for (const item of [
      'autorizacao-do-dono',
      'retorno-ensaiado',
      'treinamento-concluido',
      'unidade-piloto',
    ]) {
      const r = await put(
        s,
        url,
        um({ item, situacao: 'nao-se-aplica', evidencia: 'n/a', em: '2026-12-01' }),
      );
      expect(r.statusCode, item).toBe(400);
      expect(r.body).toMatch(/não admitem/);
    }
    expect(
      (
        await put(
          s,
          url,
          um({ item: 'apoio-e-chamados', situacao: 'nao-se-aplica', evidencia: 'ata 9', em: '2026-12-01' }),
        )
      ).statusCode,
    ).toBe(200);
    const recepcao = await entrar('SINT.RECEPCAO');
    expect((await put(recepcao, url, um({ item: 'aceite-jornada', situacao: 'pendente' }))).statusCode).toBe(
      403,
    );
    const ok = await put(s, url, {
      itens: [
        {
          item: 'unidade-piloto',
          situacao: 'cumprido',
          evidencia: 'UTI (ata 3 do comitê)',
          em: '2026-12-01',
        },
        {
          item: 'relatorio-contingencia',
          situacao: 'cumprido',
          evidencia: 'docs/marcos/M40/evidencias.md',
          em: '2026-12-01',
        },
      ],
      justificativa: J,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ gravados: 2 });
    const enf: SetorTela = (await get(s, `${M}/onda2`))
      .json()
      .setores.find((x: SetorTela) => x.setor === 'enfermagem');
    expect(enf.itens.find((i) => i.item === 'unidade-piloto')).toMatchObject({
      ok: true,
      detalhe: 'em 2026-12-01; UTI (ata 3 do comitê)',
    });
    expect(enf.registrados.find((i) => i.item === 'relatorio-contingencia')).toMatchObject({
      situacao: 'cumprido',
      alteradoPor: 'SINT.ADMIN',
    });
    const ev = trilha.eventos.filter((e) => e.evento === 'coexistencia.ligar.alterado').at(-1);
    expect(ev?.chaveNaturalAlvo).toBe(J);
  });

  it('acompanhamento: agregados por dia e unidade com o percentual; período inválido é 400', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, `${M}/onda2/acompanhamento?de=2026-12-01&ate=2026-12-03`);
    expect(r.statusCode, r.body).toBe(200);
    const a = r.json();
    expect(a).toMatchObject({ de: '2026-12-01', ate: '2026-12-03' });
    expect(
      a.checagem.find((x: { dia: string; unidade: string }) => x.dia === '2026-12-01' && x.unidade === 'UTI'),
    ).toEqual({ dia: '2026-12-01', unidade: 'UTI', horarios: 40, checados: 10, percentual: 25 });
    expect(a.higienizacao[0]).toMatchObject({
      solicitacoes: expect.any(Number),
      avancaram: expect.any(Number),
    });
    expect(
      a.registros.find((x: { dia: string; tipo: string }) => x.dia === '2026-12-03' && x.tipo === 'evolucao'),
    ).toEqual({ dia: '2026-12-03', tipo: 'evolucao', total: 40, peloNovo: 2, peloOutro: 38 });
    expect((await get(s, `${M}/onda2/acompanhamento`)).statusCode).toBe(200);
    expect((await get(s, `${M}/onda2/acompanhamento?de=2026-12-03&ate=2026-12-01`)).statusCode).toBe(400);
    expect((await get(s, `${M}/onda2/acompanhamento?de=2026-01-01&ate=2026-12-01`)).statusCode).toBe(400);
  });
});

describe('onda 2: fora de dev/ci, o lote de um setor da onda 2 exige o critério completo (regra 1)', () => {
  const sessao = (hospital: string): SessaoCadastro => ({
    req: { headers: {}, ip: '127.0.0.1' } as unknown as SessaoCadastro['req'],
    hospital,
    rede: 'r',
    login: 'SINT.ADMIN',
    porta: { rede: 'r', hospital },
    pode: () => true,
  });
  const servico = (ambiente: string) =>
    new ServicoMigracao({
      porta: new PortaCoexistenciaMemoria(
        new RegistradorTrilhaMemoria(),
        fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
      ),
      trilha: new RegistradorTrilhaMemoria(),
      administracao: null,
      fonteConfig: null,
      cache: null,
      caminhoCatalogo: resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'),
      ambiente,
      grafana: null,
      metodoMascaramento: null,
      primeiro: { codigo: 'pc', nome: 'ProntoCardio' },
      homologacao: {
        painel: () =>
          ({
            pentest: {
              situacao: 'nao-iniciado',
              abertosCriticosOuAltos: 0,
              porSeveridade: {},
              reteste: null,
              bloqueiaLiberacao: true,
            },
          }) as never,
      },
    });

  it('homologação: recusa 409 com o código e o que falta (o teste de invasão, pelo painel do M36)', async () => {
    const e = await servico('homologacao')
      .aplicarLote(sessao('pc'), { setor: 'sadt', alvo: { tipo: 'setor', valores: [] }, justificativa: J })
      .then(
        () => null,
        (x: unknown) => x as ErroProblema,
      );
    expect(e?.getStatus()).toBe(409);
    expect(e?.extras).toMatchObject({ codigo: 'criterio-onda2-incompleto' });
    expect(e?.detalhe).toContain('aceite da jornada não registrado');
    expect(e?.detalhe).toContain('teste de invasão ainda não liberado (situação: nao-iniciado)');
  });

  it('no Serrano, os setores do ProntoCardio ainda não prontos seguram o hospital (regra 8)', async () => {
    const p = await servico('homologacao').painelOnda2(sessao('hs'));
    expect(p.seguramHospital).toEqual(expect.arrayContaining(['internacao-leitos', 'agendamento']));
    const noPc = await servico('homologacao').painelOnda2(sessao('pc'));
    expect(noPc.seguramHospital).toEqual([]);
    // No pc, o catálogo declara os estados: a checagem verde segura o setor (falta a conferência); as especificadas
    // pela POL-3 ficam fora (D-OPS-40).
    const enf = noPc.setores.find((x) => x.setor === 'enfermagem')!;
    expect(enf.operacoes.find((o) => o.nome === 'enfermagem.checarAdministracao')).toMatchObject({
      estado: 'verde',
      fora: false,
    });
    // W1-08: o aprazamento também ficou verde no pc (assinatura na cópia) e passa a segurar o setor até a conferência.
    expect(enf.operacoes.find((o) => o.nome === 'enfermagem.aprazarHorario')).toMatchObject({
      estado: 'verde',
      fora: false,
    });
    expect(enf.itens.find((i) => i.item === 'operacoes-conferidas')?.falta).toMatch(
      /^operações ainda não conferidas: .*enfermagem\.checarAdministracao \(verde\)/,
    );
  });
});

describe(
  'onda 2: fora de dev/ci, ligar pela tela de chaves confere o critério do setor (regras 1 e 2)',
  {
    timeout: 30_000,
  },
  () => {
    // A sessão sintética só existe em dev/ci: a app sobe em dev e a configuração lida pelos controladores passa a
    // homologação só durante o pedido de ligar (o critério do setor é conferido fora de dev/ci).
    const cfgH = lerConfiguracao(env);
    let appH: NestFastifyApplication;
    beforeAll(async () => {
      appH = await criarApp(cfgH, null, env, { trilha: new RegistradorTrilhaMemoria() });
      await appH.init();
      await appH.getHttpAdapter().getInstance().ready();
    });
    afterAll(async () => {
      await appH.close();
    });
    const ligar = async (chaveLib: string, tipo: 'recurso' | 'operacao') => {
      const r0 = await appH.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.ADMIN', senha: SENHA },
      });
      const set = (r0.headers['set-cookie'] as string[] | undefined) ?? [];
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      const csrf =
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '';
      (cfgH as { ambiente: string }).ambiente = 'homolog';
      try {
        return await appH.inject({
          method: 'POST',
          url: '/api/administracao/liberacao',
          headers: { cookie, 'x-csrf': csrf, 'idempotency-key': `m40-chave-${++chave}-${Date.now()}` },
          payload: {
            chave: chaveLib,
            tipo,
            escopo: 'hospital',
            valores: ['*'],
            ligar: true,
            justificativa: 'Ligar sintético pela tela de chaves (teste)',
            senha: SENHA,
          },
        });
      } finally {
        (cfgH as { ambiente: string }).ambiente = 'dev';
      }
    };

    it('recurso e operação de setor da onda 2 com o critério incompleto: 409 criterio-onda2-incompleto', async () => {
      const r = await ligar('enfermagem.sinaisVitais', 'recurso');
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json()).toMatchObject({ codigo: 'criterio-onda2-incompleto' });
      expect(r.json().detail).toMatch(/aceite da jornada não registrado/);
      const o = await ligar('enfermagem.checarAdministracao', 'operacao');
      expect(o.statusCode, o.body).toBe(409);
      expect(o.json()).toMatchObject({ codigo: 'criterio-onda2-incompleto' });
      // A chave que a onda 1 já usa (a senha da recepção) segue a lista da onda 1, não o critério da onda 2.
      const senha = await ligar('recepcao.emitirSenha', 'operacao');
      expect(senha.json().codigo).not.toBe('criterio-onda2-incompleto');
    });
  },
);

describe('onda 2: o critério do setor para a tela de chaves (serviço)', () => {
  it('a chave fora da onda 2 não é conferida; a da onda 2 diz o setor e o que falta', async () => {
    const s = new ServicoMigracao({
      porta: new PortaCoexistenciaMemoria(
        new RegistradorTrilhaMemoria(),
        fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
      ),
      trilha: new RegistradorTrilhaMemoria(),
      administracao: null,
      fonteConfig: null,
      cache: null,
      caminhoCatalogo: resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'),
      ambiente: 'homologacao',
      grafana: null,
      metodoMascaramento: null,
      primeiro: { codigo: 'pc', nome: 'ProntoCardio' },
    });
    const c = { rede: 'r', hospital: 'pc' };
    expect(await s.motivoLigarChaveOnda2(c, 'operacao', 'recepcao.emitirSenha')).toBeNull();
    expect(await s.motivoLigarChaveOnda2(c, 'recurso', 'enfermagem.sinaisVitais')).toMatch(
      /^Enfermagem \(unidade-piloto: CTI\): Critério de liberação incompleto: .*teste de invasão/,
    );
  });
});
