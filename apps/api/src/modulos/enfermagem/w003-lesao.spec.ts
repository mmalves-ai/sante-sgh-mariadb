// W0-03, mercado M4 (critério 12): feridas e LPP pela API — a lesão com a ficha em rascunho (livre do autor) e
// finalizada (só o autor corrige, com a justificativa; a anterior fica legível); o curativo e a correção dele; a foto
// como referência ao anexo do prontuário; a sugestão de notificação ao NSP na LPP adquirida; a incidência com o
// numerador e o denominador; o encerramento; a inativação só do autor com a senha, recusada na lesão com curativo ou
// foto vigente (com a contagem); nenhuma rota de exclusão. Porta em memória; relógio controlado; dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-25 08:00 em São Paulo. */
const relogio = Date.parse('2026-10-25T11:00:00Z');
const agora = () => new Date(relogio);

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria(
    fonteCatalogoArquivo(resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo')),
    { agora },
  );
  const escores = new PortaEscoresMemoria({ agora });
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    enfermagem,
    escores,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
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
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': `teste-w003-m4-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
    del: (s: Sessao, url: string) =>
      app.inject({
        method: 'DELETE',
        url: `/api${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-w003-m4-${++seq}` },
      }),
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;
let a: Montado;
beforeAll(async () => {
  a = await montar();
});
afterAll(async () => {
  await a.app.close();
});

/** O internado da enfermaria admitido às 06:00 (duas horas antes do relógio). */
const P4 = { paciente: 25004, atendimento: 25104 };
const LEITO = {
  granulacao: 70,
  epitelizacao: 10,
  esfacelo: 20,
  necrose: 0,
  exsudato: 'escasso',
  odor: false,
  sinaisInfeccao: false,
  dor: 3,
};
const DADOS = {
  tipo: 'lpp',
  regiao: 'sacral',
  estagio: 'estagio2',
  relacionadaDispositivo: false,
  presenteNaAdmissao: false,
  identificadaEm: '2026-10-25T07:40',
  medidas: { comprimento: 3, largura: 2, profundidade: null },
  leito: LEITO,
  cobertura: 'hidrocoloide',
};
const CURATIVO = {
  realizadoEm: '2026-10-25T07:50',
  estagio: 'estagio2',
  medidas: { comprimento: 3, largura: 2, profundidade: null },
  leito: LEITO,
  cobertura: 'hidrocoloide',
};

describe('W0-03, M4: feridas e LPP pela API', () => {
  it('do rascunho à finalizada; correção com a justificativa; curativo, foto, NSP, incidência, encerramento', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const med = await a.entrar('SINT.MEDICO');
    // A conferência da ficha: a LPP sem estágio, a "presente na admissão" fora da janela não passam.
    const semEstagio = await a.post(enf, '/enfermagem/lesoes', {
      ...P4,
      dados: { ...DADOS, estagio: null },
      finalizar: false,
    });
    expect(semEstagio.statusCode).toBe(422);
    expect(semEstagio.json().codigo).toBe('lpp-sem-estagio');
    const antes = await a.post(enf, '/enfermagem/lesoes', {
      ...P4,
      dados: { ...DADOS, identificadaEm: '2026-10-25T05:00' },
      finalizar: false,
    });
    expect(antes.json().codigo).toBe('identificada-antes-da-admissao');

    // O rascunho: livre do autor; outro usuário não mexe.
    const r = await a.post(enf, '/enfermagem/lesoes', {
      ...P4,
      dados: { ...DADOS, medidas: null },
      finalizar: false,
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    const tela = (await a.get(enf, '/enfermagem/lesoes/unidade?unidade=ENF1')).json();
    expect(tela.lesoes).toEqual([
      expect.objectContaining({ id, situacao: 'rascunho', origem: 'adquirida', sugerirNotificacao: false }),
    ]);
    expect(tela.gravacao.agir).toBe(true);
    const deOutro = await a.post(med, `/enfermagem/lesoes/${id}/versoes`, { dados: DADOS, finalizar: true });
    expect(deOutro.statusCode).toBe(409);
    expect(deOutro.json().codigo).toBe('so-o-autor');
    const semMedidas = await a.post(enf, `/enfermagem/lesoes/${id}/versoes`, {
      dados: { ...DADOS, medidas: null },
      finalizar: true,
    });
    expect(semMedidas.json().codigo).toBe('finalizada-sem-medidas');
    const fin = await a.post(enf, `/enfermagem/lesoes/${id}/versoes`, { dados: DADOS, finalizar: true });
    expect(fin.statusCode, fin.body).toBe(201);
    expect(fin.json().versao).toBe(2);

    // A finalizada: a correção só com a justificativa, já finalizada; a anterior fica legível.
    const semMotivo = await a.post(enf, `/enfermagem/lesoes/${id}/versoes`, {
      dados: { ...DADOS, regiao: 'coccigea' },
      finalizar: true,
    });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().codigo).toBe('correcao-sem-motivo');
    const corr = await a.post(enf, `/enfermagem/lesoes/${id}/versoes`, {
      dados: { ...DADOS, regiao: 'coccigea' },
      finalizar: true,
      motivo: 'Região anotada errada na avaliação',
    });
    expect(corr.statusCode, corr.body).toBe(201);
    let l = (await a.get(enf, `/enfermagem/lesoes/${id}`)).json();
    expect(l).toMatchObject({
      versao: 3,
      situacao: 'finalizada',
      motivo: 'Região anotada errada na avaliação',
      areaCm2: 6,
      sugerirNotificacao: true,
    });
    expect(l.dados.regiao).toBe('coccigea');
    expect(
      l.versoes.map((v: { versao: number; dados: { regiao: string } }) => [v.versao, v.dados.regiao]),
    ).toEqual([
      [2, 'sacral'],
      [1, 'sacral'],
    ]);

    // O curativo e a correção dele pelo autor (o anterior fica inativo e legível).
    const c1 = await a.post(enf, `/enfermagem/lesoes/${id}/curativos`, CURATIVO);
    expect(c1.statusCode, c1.body).toBe(201);
    const cAntes = await a.post(enf, `/enfermagem/lesoes/${id}/curativos`, {
      ...CURATIVO,
      realizadoEm: '2026-10-25T07:00',
    });
    expect(cAntes.json().codigo).toBe('curativo-antes-da-lesao');
    const cOutro = await a.post(med, `/enfermagem/lesoes/curativos/${c1.json().id}/corrigir`, {
      dados: CURATIVO,
      motivo: 'Cobertura registrada errada',
    });
    expect(cOutro.json().codigo).toBe('so-o-autor');
    const c2 = await a.post(enf, `/enfermagem/lesoes/curativos/${c1.json().id}/corrigir`, {
      dados: { ...CURATIVO, cobertura: 'espuma' },
      motivo: 'Cobertura registrada errada',
    });
    expect(c2.statusCode, c2.body).toBe(201);

    // A foto: a referência ao anexo do prontuário, uma vez.
    const f1 = await a.post(enf, `/enfermagem/lesoes/${id}/fotos`, {
      anexo: 7001,
      curativo: c2.json().id,
      tiradaEm: '2026-10-25T07:55',
    });
    expect(f1.statusCode, f1.body).toBe(201);
    const fDup = await a.post(enf, `/enfermagem/lesoes/${id}/fotos`, {
      anexo: 7001,
      tiradaEm: '2026-10-25T07:55',
    });
    expect(fDup.statusCode).toBe(409);
    expect(fDup.json().codigo).toBe('foto-ja-vinculada');
    l = (await a.get(enf, `/enfermagem/lesoes/${id}`)).json();
    expect(
      l.curativos.map((c: { vigente: boolean; dados: { cobertura: string } }) => [
        c.vigente,
        c.dados.cobertura,
      ]),
    ).toEqual([
      [true, 'espuma'],
      [false, 'hidrocoloide'],
    ]);
    expect(l.fotos).toEqual([
      expect.objectContaining({ anexo: 7001, curativo: c2.json().id, inativacao: null }),
    ]);

    // A incidência (para o W0-04): a LPP adquirida finalizada, com o numerador e o denominador impressos.
    const inc = (await a.get(enf, '/enfermagem/lesoes/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    expect(inc.densidade).toEqual({ numerador: 1, denominador: 16, por1000: 62.5 });
    expect(inc.pacientes).toEqual({ numerador: 1, denominador: 16, percentual: 6.3 });
    expect(inc.porEstagio).toEqual({ estagio2: 1 });
    expect(inc.impressao).toMatch(/1 \/ 16 pacientes-dia × 1\.000/);

    // A lesão com curativo e foto vigentes não se inativa (nenhum órfão): a recusa traz a contagem.
    const comRegistros = await a.post(enf, `/enfermagem/lesoes/${id}/inativar`, {
      motivo: 'Lançada no paciente errado',
      senha: SENHA,
    });
    expect(comRegistros.statusCode).toBe(409);
    expect(comRegistros.json()).toMatchObject({ codigo: 'lesao-com-registros' });
    expect(comRegistros.json().detail).toMatch(/1 curativo\(s\) e 1 foto\(s\)/);
    const senhaErrada = await a.post(enf, `/enfermagem/lesoes/fotos/${f1.json().id}/inativar`, {
      motivo: 'Foto de outro paciente',
      senha: 'errada',
    });
    expect(senhaErrada.statusCode).toBe(401);
    expect(
      (
        await a.post(med, `/enfermagem/lesoes/fotos/${f1.json().id}/inativar`, {
          motivo: 'Foto de outro paciente',
          senha: SENHA,
        })
      ).json().codigo,
    ).toBe('so-o-autor');

    // O encerramento; depois dele, nada mais se registra na lesão.
    const enc = await a.post(med, `/enfermagem/lesoes/${id}/encerrar`, {
      desfecho: 'cicatrizada',
      em: '2026-10-25T08:00',
    });
    expect(enc.statusCode, enc.body).toBe(201);
    const depois = await a.post(enf, `/enfermagem/lesoes/${id}/curativos`, CURATIVO);
    expect(depois.json().codigo).toBe('lesao-encerrada');
    l = (await a.get(enf, `/enfermagem/lesoes/${id}`)).json();
    expect(l.encerramento).toMatchObject({ desfecho: 'cicatrizada', em: '2026-10-25T08:00' });

    // Nenhuma rota de exclusão física.
    expect([404, 405]).toContain((await a.del(enf, `/enfermagem/lesoes/${id}`)).statusCode);
    expect(a.trilha.eventos.some((x) => x.evento === 'enfermagem.lesao.encerrada')).toBe(true);
  });

  it('a inativação só do autor, com a senha, na ordem: foto, curativo, lesão; continua visível e sai da incidência', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(enf, '/enfermagem/lesoes', {
      ...P4,
      dados: { ...DADOS, identificadaEm: '2026-10-25T07:45' },
      finalizar: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    const c = (await a.post(enf, `/enfermagem/lesoes/${id}/curativos`, CURATIVO)).json().id as number;
    const f = (
      await a.post(enf, `/enfermagem/lesoes/${id}/fotos`, {
        anexo: 7002,
        curativo: c,
        tiradaEm: '2026-10-25T07:55',
      })
    ).json().id as number;
    const M = { motivo: 'Lançada no paciente errado', senha: SENHA };
    // Revisão W0-03: o curativo com foto vigente não se inativa (a foto ficaria órfã): a recusa traz a contagem.
    const comFoto = await a.post(enf, `/enfermagem/lesoes/curativos/${c}/inativar`, M);
    expect(comFoto.statusCode).toBe(409);
    expect(comFoto.json()).toMatchObject({ codigo: 'curativo-com-fotos' });
    expect(comFoto.json().detail).toMatch(/1 foto\(s\) vigente\(s\)/);
    expect((await a.post(enf, `/enfermagem/lesoes/fotos/${f}/inativar`, M)).statusCode).toBe(201);
    expect((await a.post(enf, `/enfermagem/lesoes/fotos/${f}/inativar`, M)).json().codigo).toBe(
      'ja-inativado',
    );
    expect((await a.post(enf, `/enfermagem/lesoes/curativos/${c}/inativar`, M)).statusCode).toBe(201);
    const ok = await a.post(enf, `/enfermagem/lesoes/${id}/inativar`, M);
    expect(ok.statusCode, ok.body).toBe(201);
    const l = (await a.get(enf, `/enfermagem/lesoes/${id}`)).json();
    expect(l.inativacao).toMatchObject({ motivo: 'Lançada no paciente errado', usuario: 'SINT.ENF.PLANTAO' });
    expect(l.sugerirNotificacao).toBe(false);
    expect(l.curativos[0].vigente).toBe(false);
    expect(l.fotos[0].inativacao).not.toBeNull();
    const inc = (await a.get(enf, '/enfermagem/lesoes/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    // Só a lesão do primeiro teste (encerrada como cicatrizada, ainda conta: foi adquirida no período).
    expect(inc.densidade.numerador).toBe(1);
  });
});
