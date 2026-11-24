// Unidade das leituras próprias do portal (portal-leituras): o mapeamento das linhas do modelo próprio para o contrato
// da porta (o mesmo da porta de memória), o filtro do estabelecimento em toda consulta e o corte das páginas.
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  atoDaLinha,
  consentimentoDaLinha,
  contaDaLinha,
  documentoDaLinha,
  JANELA_COPIAS_DECIDIDAS,
  LeiturasPortalProprias,
  pedidoDaLinha,
  trocaDaLinha,
  vinculoDaLinha,
} from './porta-propria-leitura.js';
import { TETO_FILA_VINCULOS } from './tipos.js';

const C = { rede: 'cliente_x', hospital: 'H1' };
const EST = 77;

function fonte(resposta: (sql: string, p: readonly unknown[]) => Linha[]) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const l: Leitor = {
    cliente: C.rede,
    consultar: <T extends Linha>(sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(resposta(sql, p) as T[]);
    },
    uma: <T extends Linha>(sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve((resposta(sql, p)[0] as T | undefined) ?? null);
    },
  };
  const leituras = new LeiturasPortalProprias({
    ler: (_c, fn) => fn(l),
    estabelecimento: () => Promise.resolve(EST),
  });
  return { leituras, chamadas };
}

describe('leituras próprias do portal: linhas → contrato', () => {
  it('conta: situação do banco, convite, credencial e versão', () => {
    const k = contaDaLinha(
      {
        id: 5,
        tipo: 'paciente',
        paciente_id: 9,
        numero_prontuario: 123,
        situacao: 'pendente_ativacao',
        convite_resumo: 'r',
        convite_erradas: 2,
        convite_origem: 'recepcao',
        convidado_por: 'rec',
        tentativas_falhas: 0,
        criado_em: new Date('2026-11-01T10:00:00Z'),
        versao: 3,
      },
      'H1',
    );
    expect(k).toMatchObject({
      id: 5,
      hospital: 'H1',
      situacao: 'convidada',
      prontuario: 123,
      conviteErradas: 2,
      email: null,
      versao: 3,
    });
  });
  it('troca do e-mail: envio, expirada como cancelada e quem pediu pelo portal', () => {
    const t = trocaDaLinha({
      id: 1,
      conta_portal_paciente_id: 4,
      canal_pedido: 'portal',
      envio: 'plataforma',
      situacao: 'expirada',
      pedido_por: null,
      valido_ate: new Date(),
    });
    expect(t).toMatchObject({ envio: 'halai', situacao: 'cancelada', pedidoPor: 'SGH.PORTAL.C4' });
  });
  it('vínculo: escopos do JSON e decisor', () => {
    const v = vinculoDaLinha(
      { id: 2, paciente_id: 9, numero_prontuario: 1, escopos: '["documentos"]', canal: 'balcao', versao: 1 },
      'H1',
    );
    expect(v).toMatchObject({ escopos: ['documentos'], canal: 'balcao', titular: 9 });
  });
  it('consentimento: o revogado mostra a situação anterior', () => {
    const k = consentimentoDaLinha({
      id: 1,
      situacao: 'revogado',
      situacao_anterior: 'autorizado',
      tipo_signatario: 'representante_legal',
      emitido_em: new Date('2026-11-01T00:00:00Z'),
      revogado_em: new Date('2026-11-02T00:00:00Z'),
    });
    expect(k).toMatchObject({ situacao: 3, signatario: 2, revogadoEm: '2026-11-02T00:00:00.000Z' });
  });
  it('pedido: tipo e situação do contrato', () => {
    const p = pedidoDaLinha({ id: 8, numero: 'LGPD-1', tipo: 'informacao_compartilhamento', situacao: 'em_analise' });
    expect(p).toMatchObject({ id: '8', tipo: 'compartilhamento', situacao: 'identidade-verificada' });
  });
  it('ato da cópia: o autor é o usuário ou a conta do portal', () => {
    expect(atoDaLinha({ id: 1, ato: 'solicitacao', conta_portal_paciente_id: 3 }).usuario).toBe('SGH.PORTAL.C3');
    expect(atoDaLinha({ id: 1, ato: 'entrega', login: 'rec' }).usuario).toBe('rec');
  });
  it('documento: só o assinado tem o evento "assinado"; cancelado é suspenso', () => {
    const d = documentoDaLinha({ id: 4, situacao: 'assinado', nivel_exigido: 'icp-brasil', codigo_verificacao: 'X' });
    expect(d).toMatchObject({ eventos: ['assinado'], assinaturaIcp: 4, codigoVerificacao: 'X' });
    expect(documentoDaLinha({ id: 4, situacao: 'cancelado' }).eventos).toContain('suspenso');
  });
});

describe('leituras próprias do portal: consultas', () => {
  it('toda consulta filtra o estabelecimento da sessão', async () => {
    const { leituras, chamadas } = fonte(() => []);
    await leituras.conta(C, 1);
    await leituras.contaPorEmail(C, 'r');
    await leituras.contaPorConvite(C, 'r');
    await leituras.contaDoPaciente(C, 1);
    await leituras.contasAbertas(C);
    await leituras.trocaEmailPorToken(C, 't');
    await leituras.trocaEmailPendente(C, 1);
    await leituras.vinculosDaConta(C, 1);
    await leituras.vinculosDoTitular(C, 1);
    await leituras.vinculo(C, 1);
    await leituras.filaVinculos(C, { situacao: 'pendente' });
    await leituras.vinculosAtivos(C);
    await leituras.consentimentos(C, 1);
    await leituras.pedidos(C, 1, 1);
    await leituras.filaCopias(C, { pendentes: true });
    await leituras.atosCopia(C, '1');
    await leituras.documentos(C, 1, ['receita'], 1);
    await leituras.leituras(C, 1, ['portal.documento.visto'], '2026-11-01', '2026-11-30');
    expect(chamadas).toHaveLength(18);
    for (const x of chamadas) {
      expect(x.sql).toMatch(/estabelecimento_id = \?/);
      expect(x.p).toContain(EST);
    }
  });
  it('fila de vínculos: titulares vazios não consultam; a página corta no teto', async () => {
    const linhas = Array.from({ length: TETO_FILA_VINCULOS + 1 }, (_, i) => ({ id: i + 1, escopos: '[]' }));
    const { leituras, chamadas } = fonte(() => linhas);
    expect(await leituras.filaVinculos(C, { situacao: null, titulares: [] })).toEqual({ itens: [], haMais: false });
    expect(chamadas).toHaveLength(0);
    const r = await leituras.filaVinculos(C, { situacao: null, titulares: [9], depoisDe: 3 });
    expect(r.itens).toHaveLength(TETO_FILA_VINCULOS);
    expect(r.haMais).toBe(true);
    expect(chamadas[0]!.p).toEqual([EST, 9, 3]);
  });
  it('vínculos ativos: páginas por cursor de id até a última, sem esbarrar no teto', async () => {
    const paginas = [
      Array.from({ length: 1_000 }, (_, i) => ({ id: i + 1, escopos: '[]' })),
      [{ id: 1_001, escopos: '[]' }],
    ];
    let n = 0;
    const { leituras, chamadas } = fonte(() => paginas[n++] ?? []);
    const r = await leituras.vinculosAtivos(C);
    expect(r).toHaveLength(1_001);
    expect(chamadas.map((x) => x.p)).toEqual([
      [EST, 0],
      [EST, 1_000],
    ]);
    expect(chamadas[0]!.sql).toMatch(/v\.id > \? ORDER BY v\.id LIMIT 1000$/);
  });
  it('fila de cópias: protocolo filtra no banco; a fila completa traz os pendentes e a janela dos decididos', async () => {
    const { leituras, chamadas } = fonte(() => []);
    await leituras.filaCopias(C, { pendentes: false, protocolo: 'CP-9' });
    expect(chamadas[0]!.sql).toMatch(/t\.numero = \?/);
    expect(chamadas[0]!.sql).not.toMatch(/LIMIT/);
    expect(chamadas[0]!.p).toEqual([EST, 'CP-9', 'recebido', 'em_analise', 'aguardando_titular']);
    await leituras.filaCopias(C, { pendentes: false });
    expect(chamadas[1]!.sql).toContain(`LIMIT ${JANELA_COPIAS_DECIDIDAS}`);
    expect(chamadas[1]!.sql).toMatch(/t2\.situacao NOT IN/);
    expect(chamadas[1]!.p.filter((x) => x === EST)).toHaveLength(2);
    await leituras.filaCopias(C, { pendentes: false, idPaciente: 5 });
    expect(chamadas[2]!.sql).not.toMatch(/LIMIT/);
  });
  it('atos de cópia com id inválido: lista vazia sem consulta', async () => {
    const { leituras, chamadas } = fonte(() => []);
    expect(await leituras.atosCopia(C, 'abc')).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
  it('domínios do consentimento: os do modelo próprio', async () => {
    const { leituras } = fonte(() => []);
    expect((await leituras.dominiosConsentimento()).situacoes.map((s) => s.id)).toEqual([1, 3, 4]);
  });
});
