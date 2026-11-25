// 01-ADM L82 pela rota de documentos do prontuário (POST /api/pep/paciente/:p/documentos/:tipo/:id/imprimir): a 1ª
// via sem justificativa é recusada (400, campo justificativa); com ela, sai o PDF da via 1 e o evento "impresso" fica
// no documento do prontuário com o texto; a 2ª chamada é nova via e exige o motivo do catálogo de reimpressão (01-ADM
// L79: um só caminho de motivo; texto livre, motivo inativo e complemento faltando são recusados antes de emitir) e
// grava "segunda-via" com a descrição do motivo e a via no registro de reimpressões; a trilha registra a via. O que o evento deixa no MariaDB está provado em
// documentos-porta-propria.int.spec.ts (documento_prontuario_evento com tipo, usuário, justificativa e hora). Portas
// em memória, serviço de emissão do Compose (Gotenberg em 127.0.0.1); massa SINTÉTICA. Fora do `pnpm verificar`.
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/fonte.js';
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

    // A 1ª via já existe (vem do registro das emissões): a tela sabe pela rota das vias, com os motivos ativos.
    const vias = await app.inject({
      method: 'GET',
      url: `/api/pep/paciente/1001/documentos/atestado/${origem}/vias`,
      headers: { cookie },
    });
    expect(vias.statusCode).toBe(200);
    expect(vias.json()).toMatchObject({ impresso: true });
    expect((vias.json().motivos as { id: number }[]).map((m) => m.id)).toEqual([1, 2]);
    // Sem motivo do catálogo (nem com texto livre), inativo ou sem o complemento pedido: recusa antes de emitir.
    for (const [payload, codigo, campo] of [
      [{}, 'motivo-obrigatorio', 'motivoReimpressao'],
      [{ motivo: 'Via extraviada pelo setor' }, 'motivo-obrigatorio', 'motivoReimpressao'],
      [{ motivoReimpressao: 3 }, 'motivo-inativo', 'motivoReimpressao'],
      [{ motivoReimpressao: 99 }, 'motivo-inexistente', 'motivoReimpressao'],
      [{ motivoReimpressao: 2, complemento: 'abc' }, 'complemento-obrigatorio', 'complemento'],
    ] as const) {
      const x = await imprimir(payload);
      expect(x.statusCode).toBe(400);
      expect(x.json()).toMatchObject({ codigo, campos: [campo] });
    }
    expect(documentos.reimpressoes).toEqual([]);
    const dois = await imprimir({ motivoReimpressao: 1 });
    expect(dois.statusCode).toBe(200);
    expect(dois.headers['content-disposition']).toMatch(/via2\.pdf/);
    const tres = await imprimir({ motivoReimpressao: 2, complemento: 'Pedido do convênio' });
    expect(tres.statusCode).toBe(200);
    expect(tres.headers['content-disposition']).toMatch(/via3\.pdf/);
    expect((await eventos()).map((e) => [e.tipo, e.justificativa])).toEqual([
      ['impresso', just],
      ['segunda-via', 'Perda da via anterior'],
      ['segunda-via', 'Outro motivo: Pedido do convênio'],
    ]);
    expect(documentos.reimpressoes.map((r) => [r.motivo, r.via])).toEqual([
      [1, 2],
      [2, 3],
    ]);

    const alvos = trilha.eventos
      .map((e) => e.chaveNaturalAlvo ?? '')
      .filter((c) => c.startsWith('impresso:atestado'));
    expect(alvos).toEqual([
      'impresso:atestado;via:1;justificativa:emissao+evento',
      'impresso:atestado;via:2;motivo:catalogo;registro:1',
      'impresso:atestado;via:3;motivo:catalogo;registro:2',
    ]);
    expect(documentos.reimpressoes.map((r) => r.emissao)).toEqual(['emitida', 'emitida']);

    // A via é registrada ANTES de emitir: se a gravação falha (banco fora, motivo desativado no meio, disputa de
    // versão), nenhum PDF sai e nenhuma via da emissão é gasta; a próxima reimpressão é a via 4.
    const registrar = documentos.registrarNovaVia.bind(documentos);
    documentos.registrarNovaVia = () => Promise.reject(new Error('gravação recusada (simulada)'));
    const falhaGravar = await imprimir({ motivoReimpressao: 1 });
    documentos.registrarNovaVia = registrar;
    expect(falhaGravar.statusCode).toBeGreaterThanOrEqual(500);
    expect(falhaGravar.headers['content-type'] ?? '').not.toMatch(/pdf/);
    expect(documentos.reimpressoes).toHaveLength(2);
    const quatro = await imprimir({ motivoReimpressao: 1 });
    expect(quatro.statusCode).toBe(200);
    expect(quatro.headers['content-disposition']).toMatch(/via4\.pdf/);

    // Se a emissão do PDF falha depois do registro, o pedido fica no registro marcado como não emitido (nunca
    // apagado); a via seguinte fecha com a via que o PDF levou.
    const emissao = app.get<FonteDocumento>(FONTE_DOCUMENTO).emissao;
    const segunda = emissao.segundaVia.bind(emissao);
    emissao.segundaVia = () => Promise.reject(new Error('emissão fora (simulada)'));
    const falhaEmitir = await imprimir({ motivoReimpressao: 1 });
    emissao.segundaVia = segunda;
    expect(falhaEmitir.statusCode).toBe(503);
    const cinco = await imprimir({ motivoReimpressao: 1 });
    expect(cinco.statusCode).toBe(200);
    expect(cinco.headers['content-disposition']).toMatch(/via5\.pdf/);
    expect(documentos.reimpressoes.map((r) => [r.via, r.emissao])).toEqual([
      [2, 'emitida'],
      [3, 'emitida'],
      [4, 'emitida'],
      [5, 'nao-emitida'],
      [5, 'emitida'],
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
