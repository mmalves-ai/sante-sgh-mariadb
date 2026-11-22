// W0-09 (programa CRUD completo), parte 4a, pela HTTP sobre a fonte SINTÉTICA e a configuração EM MEMÓRIA (nenhuma
// conexão real, nenhum dado de pessoa):
//   - perfil concedido: alterar a vigência e o motivo com justificativa e senha; o anterior fica na alteração; a
//     permissão efetiva muda na requisição seguinte (cache invalidado) e o evento vai à trilha;
//   - parâmetro hierárquico: retirar a sobreposição fecha a versão (quem, motivo; nada se apaga) e o nível volta a
//     herdar; sem sobreposição, 409.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaSessao, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRO_MODULOS } from '../registro.js';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';

// As rotas da gestão de acessos só existem com o módulo "acesso" registrado (REGISTRO_MODULOS): até lá, a bateria
// fica pulada (pendência registrada na saída do lote 02-03) e volta sozinha quando o módulo entrar no registro.
const ACESSO_REGISTRADO = 'acesso' in REGISTRO_MODULOS;
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  ...(ACESSO_REGISTRADO ? { API_MODULOS: 'acesso,config' } : {}),
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  if (!ACESSO_REGISTRADO) return;
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
  reiniciarEstadoAcessoSintetico();
});

interface Navegador {
  cookies: Map<string, string>;
}
function guardar(n: Navegador, set: string | string[] | undefined): void {
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (!par || i < 0) continue;
    if (/Max-Age=0/.test(c) || par.slice(i + 1) === '') n.cookies.delete(par.slice(0, i));
    else n.cookies.set(par.slice(0, i), par.slice(i + 1));
  }
}
const h = (n: Navegador) => ({
  cookie: [...n.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  'x-csrf': n.cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-w009-4a-${++chave}-${Date.now()}`,
});
async function entrar(login: string): Promise<Navegador> {
  const n: Navegador = { cookies: new Map() };
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  guardar(n, r.headers['set-cookie']);
  return n;
}
const permissoes = async (n: Navegador) =>
  esquemaSessao.parse((await app.inject({ method: 'GET', url: '/api/sessao', headers: h(n) })).json())
    .permissoes;

describe.skipIf(!ACESSO_REGISTRADO)('W0-09: perfil concedido com vigência e motivo alteráveis', () => {
  it('alterar: anterior na alteração, permissão efetiva muda na requisição seguinte, evento na trilha; recusas', async () => {
    const gestor = await entrar('SINT.GESTOR');
    const alvo = await entrar('SINT.RECEPCAO');
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    const c = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis',
      headers: h(gestor),
      payload: {
        login: 'SINT.RECEPCAO',
        perfil: 'administrador-sistema',
        motivo: 'chamado 7',
        fim: amanha,
        senha: SENHA,
      },
    });
    expect(c.statusCode).toBe(201);
    const id = c.json().id as string;
    expect(await permissoes(alvo)).toContain('config.parametro.ler');

    const url = `/api/acesso/gestao/perfis/${id}/alteracao`;
    const base = {
      inicio: amanha,
      fim: null,
      motivo: 'cobertura de férias',
      justificativa: 'férias adiadas',
    };
    // Sem justificativa, fim no passado, senha errada e concessão inexistente: nada muda.
    const semJust = await app.inject({
      method: 'POST',
      url,
      headers: h(gestor),
      payload: { ...base, justificativa: '', senha: SENHA },
    });
    expect(semJust.statusCode).toBe(400);
    const passado = await app.inject({
      method: 'POST',
      url,
      headers: h(gestor),
      payload: {
        ...base,
        inicio: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        fim: new Date(Date.now() - 86_400_000).toISOString(),
        senha: SENHA,
      },
    });
    expect(passado.statusCode).toBe(400);
    const senhaErrada = await app.inject({
      method: 'POST',
      url,
      headers: h(gestor),
      payload: { ...base, senha: 'errada' },
    });
    expect(senhaErrada.statusCode).toBe(401);
    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/perfis/999999/alteracao',
      headers: h(gestor),
      payload: { ...base, senha: SENHA },
    });
    expect(inexistente.statusCode).toBe(404);
    expect(await permissoes(alvo)).toContain('config.parametro.ler');

    // Início adiado para amanhã: a concessão deixa de valer hoje, já na requisição seguinte do afetado.
    const ok = await app.inject({
      method: 'POST',
      url,
      headers: h(gestor),
      payload: { ...base, senha: SENHA },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ operacao: 'acesso.alterarPerfil', invalidado: 'usuario' });
    expect(await permissoes(alvo)).not.toContain('config.parametro.ler');
    expect(
      trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.perfilAlterado.codigo && e.usuario === 'SINT.GESTOR',
      ),
    ).toBe(true);

    const hist = await app.inject({
      method: 'GET',
      url: `/api/acesso/gestao/perfis/${id}/alteracoes`,
      headers: h(gestor),
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json()).toHaveLength(1);
    expect(hist.json()[0]).toMatchObject({
      fimAntes: amanha,
      motivoAntes: 'chamado 7',
      inicio: amanha,
      fim: null,
      motivo: 'cobertura de férias',
      justificativa: 'férias adiadas',
      alteradoPor: 'SINT.GESTOR',
    });
    const ef = (
      await app.inject({
        method: 'GET',
        url: '/api/acesso/gestao/usuarios/SINT.RECEPCAO',
        headers: h(gestor),
      })
    ).json();
    expect(ef.concessoes[0]).toMatchObject({
      id,
      motivo: 'cobertura de férias',
      vigente: false,
      alteracoes: 1,
    });

    // Segregação (a mesma regra da gravação no banco): ninguém altera o próprio perfil.
    expect(
      estadoAcessoSintetico().alterarPerfil({
        id,
        inicio: new Date(),
        fim: null,
        motivo: 'x',
        justificativa: 'a si mesmo',
        por: 'SINT.RECEPCAO',
      }),
    ).toEqual({ situacao: 'a-si-mesmo' });
  });
});

describe.skipIf(!ACESSO_REGISTRADO)(
  'W0-09: parâmetro hierárquico — retirar a sobreposição volta a herdar',
  () => {
    it('fecha a versão com quem e o motivo (nada se apaga), herda do padrão, 409 sem sobreposição', async () => {
      const s = await entrar('SINT.ADMIN');
      const url = '/api/administracao/parametros/cadastro.itensPorPagina';
      const def = await app.inject({
        method: 'PUT',
        url,
        headers: h(s),
        payload: {
          nivel: 'estabelecimento',
          alvo: 'aa',
          valor: '40',
          justificativa: 'ajuste sintético de teste',
        },
      });
      expect(def.statusCode).toBe(200);
      const curta = await app.inject({
        method: 'POST',
        url: `${url}/retirada`,
        headers: h(s),
        payload: { nivel: 'estabelecimento', alvo: 'aa', justificativa: 'curta' },
      });
      expect(curta.statusCode).toBe(400);
      const r = await app.inject({
        method: 'POST',
        url: `${url}/retirada`,
        headers: h(s),
        payload: { nivel: 'estabelecimento', alvo: 'aa', justificativa: 'volta ao padrão da rede' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ valorAnterior: '40', fechadas: [def.json().id] });
      expect(r.json().parametro.explicacao).toMatchObject({ valor: '25', origem: 'padrao' });
      expect(trilha.eventos.some((x) => x.evento === EVENTOS_AUDITAVEIS.parametroRetirado.codigo)).toBe(true);
      const um = (await app.inject({ method: 'GET', url, headers: h(s) })).json();
      expect(um.versoes.find((v: { id: string }) => v.id === def.json().id)).toMatchObject({
        valor: '40',
        retiradaPor: 'SINT.ADMIN',
        retiradaMotivo: 'volta ao padrão da rede',
      });
      expect(um.versoes.find((v: { id: string }) => v.id === def.json().id).vigenteAte).not.toBeNull();
      const deNovo = await app.inject({
        method: 'POST',
        url: `${url}/retirada`,
        headers: h(s),
        payload: { nivel: 'estabelecimento', alvo: 'aa', justificativa: 'volta ao padrão da rede' },
      });
      expect(deNovo.statusCode).toBe(409);
      expect(deNovo.json()).toMatchObject({ codigo: 'sem-sobreposicao' });
      const crit = await app.inject({
        method: 'POST',
        url: '/api/administracao/parametros/acesso.emergenciaMinutos/retirada',
        headers: h(s),
        payload: { nivel: 'rede', alvo: 'rede-teste', justificativa: 'parâmetro crítico sem a senha' },
      });
      expect(crit.statusCode).toBe(401);
    });
  },
);
