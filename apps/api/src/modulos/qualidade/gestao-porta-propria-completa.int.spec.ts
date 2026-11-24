// Integração da porta PRÓPRIA completa da gestão da qualidade (modulos-proprios-1, qualidade-b) contra o MariaDB do
// cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos; a limpeza tira as linhas dos assuntos novos antes
// da limpeza comum da massa.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { type GeracaoEnvioComArquivo, PortaGestaoPropriaCompleta } from './gestao-porta-propria-completa.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'envio_regulatorio_qualidade',
  entidadeId: null,
  correlacao: 'teste-qualidade-b-gestao',
};
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
// Conteúdos sintéticos do arquivo e os resumos deles (o resumo é conferido contra os bytes antes de guardar).
const A1 = 'competencia;indicador;valor\n2026-09;SINT-1;3\n';
const A2 = 'competencia;indicador;valor\n2026-09;SINT-1;4\n';
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const H1 = sha(A1);
const H2 = sha(A2);
/** A geração com o conteúdo do arquivo (o tipo do gravador ainda não declara `conteudo`). */
const geracao = (g: GeracaoEnvioComArquivo) => g;
const CONTEUDO: Record<string, string> = { [H1]: A1, [H2]: A2 };

describe.skipIf(SEM_BANCO_QUA)(`porta própria completa da gestão da qualidade (${CLIENTE_QUA})`, () => {
  let m: MassaQualidade;
  let porta: PortaGestaoPropriaCompleta;
  let c: ReturnType<typeof ctxBanco>;
  let cOutro: ReturnType<typeof ctxBanco>;
  let agora: string;
  let raiz = '';

  const limparNovos = () =>
    m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-b' }, async (e) => {
      await e.executar('DELETE FROM envio_regulatorio_qualidade WHERE estabelecimento_id IN (?, ?)', [
        m.est,
        m.outro,
      ]);
      // Os arquivos sintéticos guardados pelos envios do teste (imutáveis no produto; a limpeza do teste é direta).
      await e.executar(
        `DELETE FROM arquivo WHERE entidade = 'envio_regulatorio_qualidade' AND estabelecimento_id IN (?, ?)`,
        [m.est, m.outro],
      );
    });

  beforeAll(async () => {
    m = await prepararMassaQualidade('B');
    raiz = mkdtempSync(join(tmpdir(), 'qualidade-envio-'));
    porta = new PortaGestaoPropriaCompleta(
      m.nucleo,
      criarArmazemLocal(m.nucleo, { raiz, executor: m.nucleo.criarExecutor() }),
    );
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
    agora = await porta.relogio(c);
    await limparNovos();
  }, 60_000);
  afterAll(async () => {
    if (m) await limparNovos();
    await encerrarMassaQualidade(m);
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  const gerar = (competencia: string, hash = H1, tipo = 'pmQualiss', p: PortaGestaoPropriaCompleta = porta) =>
    p.gravarSgh(c, T, (g) =>
      g.gerarEnvioRegulatorio(
        geracao({
          tipo,
          competencia,
          arquivoDe: (rev) => `${tipo}-SINT-${competencia}-r${rev}.csv`,
          conteudo: CONTEUDO[hash] ?? 'conteudo-que-nao-confere',
          hash,
          linhas: 3,
          resumo: '{"linhas":3}',
          agora,
          usuario: m.login,
        }),
      ),
    );

  it('o envio é gerado com a revisão por competência; a geração seguinte substitui a anterior', async () => {
    const r1 = await gerar('2026-09');
    expect(r1).toMatchObject({ revisao: 1, arquivo: 'pmQualiss-SINT-2026-09-r1.csv' });
    const r2 = await gerar('2026-09', H2);
    expect(r2.revisao).toBe(2);
    await gerar('2026-10', H1, 'iras');
    const lista = await porta.envios(c, '2026-09');
    expect(lista.map((e) => [e.tipo, e.competencia, e.revisao, e.situacao])).toEqual([
      ['iras', '2026-10', 1, 'gerado'],
      ['pmQualiss', '2026-09', 2, 'gerado'],
      ['pmQualiss', '2026-09', 1, 'substituido'],
    ]);
    expect(await porta.envios(c, '2026-10')).toHaveLength(1);
    const e1 = await porta.envio(c, r1.id);
    expect(e1).toMatchObject({
      versao: 2,
      hash: H1,
      linhas: 3,
      resumo: '{"linhas":3}',
      geradoPor: m.login,
      transmitidoEm: null,
      transmitidoPor: null,
      protocolo: null,
    });
    expect(e1?.geradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // Outro estabelecimento não enxerga o envio.
    expect(await porta.envio(cOutro, r1.id)).toBeNull();
    expect(await porta.envios(cOutro, '2026-01')).toEqual([]);
  });

  it('a transmissão confere a versão, a situação e o resumo; transmitida, a competência recusa nova geração', async () => {
    const r = await gerar('2026-08');
    const transmitir = (versao: number, hash: string) =>
      porta.gravarSgh(c, T, (g) =>
        g.registrarTransmissaoEnvio({
          id: r.id,
          versao,
          hash,
          transmitidoEm: agora,
          protocolo: 'PROT-SINT-1',
          usuario: m.login,
        }),
      );
    expect(await codigo(transmitir(1, H2))).toBe('versao-desatualizada');
    expect(await codigo(transmitir(9, H1))).toBe('versao-desatualizada');
    expect(await transmitir(1, H1)).toEqual({ versao: 2 });
    expect(await porta.envio(c, r.id)).toMatchObject({
      situacao: 'transmitido',
      transmitidoPor: m.login,
      protocolo: 'PROT-SINT-1',
      versao: 2,
    });
    expect(await codigo(transmitir(2, H1))).toBe('versao-desatualizada');
    expect(await codigo(gerar('2026-08'))).toBe('ja-transmitido');
    // Nada gravado pela metade: a competência segue com a única revisão.
    expect((await porta.envios(c, '2026-08')).filter((e) => e.competencia === '2026-08')).toHaveLength(1);
  });

  it('o arquivo transmitido fica guardado (chave NOT NULL) e se lê pelos bytes guardados, nunca gerado de novo', async () => {
    const r = await gerar('2026-06', H2);
    const lido = await porta.arquivoEnvio(c, r.id);
    expect(lido).toEqual({ arquivo: 'pmQualiss-SINT-2026-06-r1.csv', conteudo: A2, hash: H2 });
    expect(await porta.arquivoEnvio(cOutro, r.id)).toBeNull();
    const [col] = await m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 'teste-qualidade-b' }, (l) =>
      l.consultar(
        `SELECT IS_NULLABLE AS nulo FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'envio_regulatorio_qualidade' AND COLUMN_NAME = 'chave_objeto'`,
      ),
    );
    expect(col?.['nulo']).toBe('NO');
    const [a] = await m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 'teste-qualidade-b' }, (l) =>
      l.consultar(
        `SELECT a.imutavel, a.hash_sha256 FROM envio_regulatorio_qualidade e
           JOIN arquivo a ON a.chave_armazenamento = e.chave_objeto WHERE e.id = ?`,
        [r.id],
      ),
    );
    expect(Number(a?.['imutavel'])).toBe(1);
  });

  it('o conteúdo que não confere com o resumo, ou a instalação sem armazenamento, recusa sem gravar', async () => {
    const antes = (await porta.envios(c, '2020-01')).length;
    expect(await codigo(gerar('2026-05', 'f'.repeat(64)))).toBe('arquivo-divergente');
    expect(await codigo(gerar('2026-05', H1, 'pmQualiss', new PortaGestaoPropriaCompleta(m.nucleo)))).toBe(
      'modelo-pendente',
    );
    expect((await porta.envios(c, '2020-01')).length).toBe(antes);
  });

  it('a conta inexistente recusa sem gravar', async () => {
    const antes = (await porta.envios(c, '2020-01')).length;
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.gerarEnvioRegulatorio(
            geracao({
              tipo: 'notivisa',
              competencia: '2026-07',
              arquivoDe: () => 'x.csv',
              conteudo: A1,
              hash: H1,
              linhas: 0,
              resumo: '{}',
              agora,
              usuario: 'CONTA-QUE-NAO-EXISTE',
            }),
          ),
        ),
      ),
    ).toBe('usuario-inexistente');
    expect((await porta.envios(c, '2020-01')).length).toBe(antes);
  });
});
