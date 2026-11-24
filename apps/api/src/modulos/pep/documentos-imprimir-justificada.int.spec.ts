// 01-ADM L82 pela rota de documentos do prontuário (POST /api/pep/paciente/:p/documentos/:tipo/:id/imprimir): a 1ª
// via sem justificativa é recusada (400, campo justificativa); com ela, sai o PDF da via 1 e o evento "impresso" fica
// no documento do prontuário com o texto; a 2ª chamada é nova via, exige o motivo e grava "segunda-via" com ele; a
// trilha registra a via e onde a justificativa ficou. O que o evento deixa no MariaDB está provado em
// documentos-porta-propria.int.spec.ts (documento_prontuario_evento com tipo, usuário, justificativa e hora). Portas
// em memória, serviço de emissão do Compose (Gotenberg em 127.0.0.1); massa SINTÉTICA. Fora do `pnpm verificar`.
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { criarAppPep } from './teste.spec-util.js';

const GOTENBERG = 'http://127.0.0.1:3318';
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', GOTENBERG_URL: GOTENBERG };
const trilha = new RegistradorTrilhaMemoria();
const registro = new PortaRegistroMemoria(trilha);
const documentos = new PortaDocumentosMemoria(trilha, registro);
let app: NestFastifyApplication;

beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  app = await criarAppPep(env, { trilha, cadastro: new PortaCadastroMemoria(), registro, documentos });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
});

describe('01-ADM L82: impressão justificada de documento do prontuário', () => {
  it('1ª via exige justificativa, nova via exige motivo; os dois ficam no evento do documento e na trilha', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.MEDICO', senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = r.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '';
    let n = 0;
    const post = (url: string, payload: object) =>
      app.inject({
        method: 'POST',
        url,
        headers: { cookie, 'x-csrf': csrf, 'idempotency-key': `teste.l82.${Date.now()}.${n++}` },
        payload,
      });
    const modelos = (
      await app.inject({ method: 'GET', url: '/api/pep/paciente/1001/atestados', headers: { cookie } })
    ).json().modelos as { tipo: string; codigo: string }[];
    const at = await post('/api/pep/paciente/1001/atestados', {
      atendimento: 10011,
      tipo: 'atestado',
      modelo: modelos.find((m) => m.tipo === 'atestado')!.codigo,
      texto: 'Atesto para os devidos fins SINTETICO',
      diasAfastamento: 1,
    });
    expect(at.statusCode).toBe(201);
    const origem = at.json().origem as number;
    const imprimir = (payload: object) =>
      post(`/api/pep/paciente/1001/documentos/atestado/${origem}/imprimir`, payload);
    const eventos = async () => {
      const d = (await documentos.documentoSghDaOrigem(
        { hospital: 'aa' } as never,
        'documento_emitido',
        origem,
      )) as unknown as { eventos: { tipo: string; justificativa?: string }[] } | null;
      expect(d).not.toBeNull();
      return d!.eventos.filter((e) => e.tipo === 'impresso' || e.tipo === 'segunda-via');
    };

    const sem = await imprimir({});
    expect(sem.statusCode).toBe(400);
    expect(sem.json()).toMatchObject({ codigo: 'justificativa-obrigatoria', campos: ['justificativa'] });
    const curta = await imprimir({ justificativa: 'curta' });
    expect(curta.statusCode).toBe(400);
    expect(await eventos()).toEqual([]);

    const just = 'Entrega ao paciente ou ao responsável legal';
    const um = await imprimir({ justificativa: just });
    expect(um.statusCode).toBe(200);
    expect(um.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(um.headers['content-disposition']).toMatch(/via1\.pdf/);
    expect(await eventos()).toEqual([{ tipo: 'impresso', em: expect.any(String), justificativa: just }]);

    // A 1ª via já existe (vem do registro das emissões): sem motivo, recusa pelo campo motivo.
    const semMotivo = await imprimir({});
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json()).toMatchObject({ codigo: 'motivo-obrigatorio', campos: ['motivo'] });
    const dois = await imprimir({ motivo: 'Via extraviada pelo setor' });
    expect(dois.statusCode).toBe(200);
    expect(dois.headers['content-disposition']).toMatch(/via2\.pdf/);
    expect((await eventos()).map((e) => [e.tipo, e.justificativa])).toEqual([
      ['impresso', just],
      ['segunda-via', 'Via extraviada pelo setor'],
    ]);

    const alvos = trilha.eventos
      .map((e) => e.chaveNaturalAlvo ?? '')
      .filter((c) => c.startsWith('impresso:atestado'));
    expect(alvos).toEqual([
      'impresso:atestado;via:1;justificativa:emissao+evento',
      'impresso:atestado;via:2;justificativa:emissao+evento',
    ]);
  }, 300_000);

  it('exportar o prontuário completo exige justificativa e só entrega depois de gravado (texto, tipo e resumo)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.MEDICO', senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = r.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '';
    let n = 0;
    const exportar = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/pep/paciente/1001/exportar',
        headers: { cookie, 'x-csrf': csrf, 'idempotency-key': `teste.l82x.${Date.now()}.${n++}` },
        payload,
      });
    const antes = documentos.exportacoes.length;
    expect((await exportar({})).statusCode).toBe(400);
    expect((await exportar({ justificativa: 'curta' })).statusCode).toBe(400);
    expect(documentos.exportacoes.length).toBe(antes);

    const just = 'Cópia pedida pelo paciente para segunda opinião';
    // Ação crítica: a sessão real confirma a senha (sem ela, 401, como na tela).
    expect((await exportar({ justificativa: just })).statusCode).toBe(401);
    expect(documentos.exportacoes.length).toBe(antes);
    const ok = await exportar({ justificativa: just, senha: SENHA });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-disposition']).toMatch(/prontuario-1001\.txt/);
    expect(documentos.exportacoes.slice(antes)).toEqual([
      {
        hospital: 'aa',
        paciente: 1001,
        justificativa: just,
        tipoJustificativa: null,
        linhas: ok.body.split('\r\n').length,
        hash: createHash('sha256').update(ok.body, 'utf8').digest('hex'),
      },
    ]);
    expect(
      trilha.eventos.some(
        (e) => e.tabelaAlvo === 'exportacao_documento' && (e.chaveNaturalAlvo ?? '').startsWith('exportado;'),
      ),
    ).toBe(true);
  }, 120_000);
});
